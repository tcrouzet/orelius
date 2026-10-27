import { diffToGroups } from "./diff.ts";
import { relative, resolve, sep } from "node:path";

export interface TextRange { from: number; to: number }
export interface RevisionHighlight { before: string; after: string }
export interface RevisionMark extends TextRange { removed: string }
export interface RevisionPlan {
  path: string;
  source: string;
  expected: string;
  ranges: TextRange[];
  intentRecorded: boolean;
}

function pathKey(path: string): string { return path.normalize("NFC").toLowerCase(); }

export function revisionKey(cwd: string, path: string): string {
  return pathKey(relative(cwd, resolve(cwd, path)).split(sep).join("/"));
}

export function revisionFor(plans: readonly RevisionPlan[], cwd: string, requested: string): RevisionPlan | undefined {
  const key = revisionKey(cwd, requested);
  return plans.find(plan => pathKey(plan.path) === key);
}

export function revisionPath(plan: RevisionPlan, cwd: string, bibleFolder: string, requested: string): string {
  const key = revisionKey(cwd, requested);
  const knowledge = `${bibleFolder}/Suivi/Connaissances.md`;
  for (const allowed of [plan.path, knowledge]) if (key === pathKey(allowed)) return allowed;
  throw new Error("Cette révision autorise seulement le chapitre ciblé et la base de connaissances éditoriales.");
}

function paragraphs(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let current: TextRange | null = null;
  for (const match of text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    if (match[0].trim()) {
      if (!current) current = { from: match.index!, to: 0 };
      current.to = match.index! + match[0].length;
    } else if (current) { ranges.push(current); current = null; }
  }
  if (current) ranges.push(current);
  return ranges;
}

export function planRevision(path: string, source: string, baseline?: string): RevisionPlan {
  const touched: TextRange[] = [];
  let offset = 0;
  if (baseline !== undefined) for (const change of diffToGroups(baseline, source, true)) {
    const from = change.delFrom + offset;
    const length = change.insText?.length ?? 0;
    if (length) touched.push({ from, to: from + length });
    offset += length - (change.delTo - change.delFrom);
  }
  for (const match of source.matchAll(/\(\(\([\s\S]*?\)\)\)|~~[\s\S]*?~~/g)) {
    touched.push({ from: match.index!, to: match.index! + match[0].length });
  }
  const ranges = paragraphs(source).filter(paragraph => touched.some(range => range.from < paragraph.to && range.to > paragraph.from));
  if (!ranges.length && (baseline === undefined || baseline === source)) throw new Error(baseline === undefined
    ? "Aucune référence Codex ni annotation ne permet de délimiter une révision. Annotez les passages à reprendre."
    : "Aucun paragraphe corrigé ou annoté à réviser. Les passages intacts sont protégés.");
  return { path, source, expected: source, ranges, intentRecorded: false };
}

export function checkRevision(plan: RevisionPlan, current: string | undefined, proposed: string): void {
  if (current !== plan.expected) throw new Error("Le chapitre a changé depuis la demande de révision. Votre texte est conservé ; relancez Réviser.");
  if (!plan.intentRecorded) throw new Error("Révision refusée : consignez d’abord l’intention des corrections dans la base de connaissances éditoriales.");
  for (const change of diffToGroups(plan.source, proposed, true)) {
    if (!plan.ranges.some(range => change.delFrom >= range.from && change.delTo <= range.to)) {
      const line = plan.source.slice(0, change.delFrom).split("\n").length;
      throw new Error(`Révision refusée : modification hors des paragraphes corrigés par l’auteur, vers la ligne ${line}. Cette écriture n’a pas été publiée.`);
    }
  }
  for (const change of diffToGroups(plan.source, proposed)) {
    if (change.insText && /==|<\/?mark\b/i.test(change.insText)) throw new Error("Révision refusée : le surlignage doit rester visuel, sans balise dans le manuscrit.");
  }
}

export function revisionMarks(snapshot: RevisionHighlight, current: string): RevisionMark[] {
  const before = snapshot.before.replace(/\r\n?/g, "\n");
  const after = snapshot.after.replace(/\r\n?/g, "\n");
  let offset = 0;
  const marks = diffToGroups(before, after, true).flatMap(block => {
    const start = block.delFrom + offset;
    offset += (block.insText?.length ?? 0) - (block.delTo - block.delFrom);
    let innerOffset = 0;
    return diffToGroups(block.delText, block.insText ?? "").map(change => {
      const from = start + change.delFrom + innerOffset;
      const to = from + (change.insText?.length ?? 0);
      innerOffset += (change.insText?.length ?? 0) - (change.delTo - change.delFrom);
      return { from, to, removed: change.delText };
    });
  });
  const edits = diffToGroups(after, current);
  return marks.flatMap(mark => {
    let shift = 0;
    for (const edit of edits) {
      if (edit.delFrom < mark.to && edit.delTo > mark.from
        || edit.delFrom === edit.delTo && edit.delFrom > mark.from && edit.delFrom < mark.to
        || mark.from === mark.to && edit.delFrom <= mark.from && edit.delTo >= mark.to) return [];
      if (edit.delTo <= mark.from) shift += (edit.insText?.length ?? 0) - (edit.delTo - edit.delFrom);
    }
    return [{ ...mark, from: mark.from + shift, to: mark.to + shift }];
  });
}
