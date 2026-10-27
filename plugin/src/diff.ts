export interface DiffGroup {
  delFrom: number; // offset de début dans le texte original (du tronçon)
  delTo: number; // offset de fin (exclusif) dans le texte original
  delText: string;
  insText: string | null;
}

type DiffOp = { op: "equal" | "del" | "ins"; text: string };

function tokenize(text: string, lines: boolean): string[] {
  if (lines) return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return text.match(/[\p{L}\p{M}\p{N}_]+|[^\p{L}\p{M}\p{N}_]+/gu) ?? [];
}
function sparseDiff(a: string[], b: string[]): DiffOp[] | null {
  const frontier = new Map<number, number>([[1, 0]]), trace: Map<number, number>[] = [];
  let work = 0;
  for (let depth = 0; depth <= Math.min(a.length + b.length, 512); depth++) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x = diagonal === -depth || diagonal !== depth && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1)
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; if (++work > 4_000_000) return null; }
      frontier.set(diagonal, x);
      if (x < a.length || y < b.length) continue;
      const ops: DiffOp[] = [];
      for (let d = depth; d >= 0; d--) {
        const previous = trace[d], k = x - y;
        const previousK = k === -d || k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK;
        while (x > previousX && y > previousY) { ops.push({ op: "equal", text: a[--x] }); y--; }
        if (d > 0) ops.push(x === previousX ? { op: "ins", text: b[--y] } : { op: "del", text: a[--x] });
      }
      return ops.reverse();
    }
  }
  return null;
}

function tokenDiff(original: string, revised: string, lines: boolean): DiffOp[] {
  const a = tokenize(original, lines);
  const b = tokenize(revised, lines);
  const n = a.length;
  const m = b.length;
  const isWord = (token: string) => /^[\p{L}\p{M}\p{N}_]/u.test(token);
  const wordsA = a.filter(isWord), wordsB = b.filter(isWord);
  if (!lines && wordsA.length === wordsB.length && wordsA.every((word, index) => word === wordsB[index])) {
    const ops: DiffOp[] = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      const before = i < n && !isWord(a[i]) ? a[i++] : "";
      const after = j < m && !isWord(b[j]) ? b[j++] : "";
      if (before === after) { if (before) ops.push({ op: "equal", text: before }); }
      else {
        if (before) ops.push({ op: "del", text: before });
        if (after) ops.push({ op: "ins", text: after });
      }
      if (i < n) { ops.push({ op: "equal", text: a[i++] }); j++; }
    }
    return ops;
  }
  let prefix = 0, suffix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  while (suffix < n - prefix && suffix < m - prefix && a[n - suffix - 1] === b[m - suffix - 1]) suffix++;
  if (prefix || suffix) {
    return [
      { op: "equal", text: a.slice(0, prefix).join("") },
      ...tokenDiff(a.slice(prefix, n - suffix).join(""), b.slice(prefix, m - suffix).join(""), lines),
      { op: "equal", text: a.slice(n - suffix).join("") },
    ];
  }
  if (n * m > 4_000_000) {
    const sparse = sparseDiff(a, b);
    if (sparse) return sparse;
    if (lines) throw new Error("Diff trop étendu pour délimiter les corrections avec certitude. Révision refusée.");
    return [
      { op: "del", text: original },
      { op: "ins", text: revised },
    ];
  }

  const dp = Array.from<Uint32Array>({ length: n + 1 });
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: "del", text: a[i] });
      i++;
    } else {
      ops.push({ op: "ins", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ op: "del", text: a[i++] });
  while (j < m) ops.push({ op: "ins", text: b[j++] });
  const merged: DiffOp[] = [];
  for (const o of ops) {
    const last = merged[merged.length - 1];
    if (last && last.op === o.op) last.text += o.text;
    else merged.push({ ...o });
  }
  return merged;
}

export function diffToGroups(original: string, revised: string, lines = false): DiffGroup[] {
  const ops = tokenDiff(original, revised, lines);
  const groups: DiffGroup[] = [];
  let pos = 0;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.op === "equal") {
      pos += op.text.length;
      i++;
      continue;
    }
    const groupStart = pos;
    let delText = "";
    let insText = "";
    while (i < ops.length && ops[i].op !== "equal") {
      if (ops[i].op === "del") {
        delText += ops[i].text;
        pos += ops[i].text.length;
      } else {
        insText += ops[i].text;
      }
      i++;
    }
    const removed = Array.from(delText), added = Array.from(insText);
    let prefix = 0, suffix = 0;
    while (prefix < removed.length && prefix < added.length && removed[prefix] === added[prefix] && !/[\p{L}\p{M}\p{N}_]/u.test(removed[prefix])) prefix++;
    while (suffix < removed.length - prefix && suffix < added.length - prefix && removed[removed.length - suffix - 1] === added[added.length - suffix - 1] && !/[\p{L}\p{M}\p{N}_]/u.test(removed[removed.length - suffix - 1])) suffix++;
    const replacement = added.slice(prefix, added.length - suffix).join("");
    groups.push({
      delFrom: groupStart + removed.slice(0, prefix).join("").length,
      delTo: pos - removed.slice(removed.length - suffix).join("").length,
      delText: removed.slice(prefix, removed.length - suffix).join(""),
      insText: replacement || null,
    });
  }
  return groups;
}
