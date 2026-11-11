import { t } from "./i18n.ts";
import { createHash } from "node:crypto";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import type { ProjectFolders } from "./settings.ts";

export const PRIORITY_LEVELS = ["essentiel", "secondaire", "a-eviter", "suspendu"] as const;
export interface EditorialObjective { path: string; goal: string; level: typeof PRIORITY_LEVELS[number] }
const START = "<!-- orelius:priorities:start -->", END = "<!-- orelius:priorities:end -->";
interface Evidence { subject: string; value: "up" | "heart" | "down"; report: string; message: string }
interface RatedObjective { goal: string; evidence: Evidence[] }
const key = (goal: string) => createHash("sha256").update(goal).digest("hex");

export function parseEditorialObjectives(value: unknown): EditorialObjective[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item: unknown): item is EditorialObjective => !!item && typeof item === "object"
    && "path" in item && typeof item.path === "string" && "goal" in item && typeof item.goal === "string" && !!item.goal.trim()
    && "level" in item && typeof item.level === "string" && (PRIORITY_LEVELS as readonly string[]).includes(item.level));
}

export function bibleReference(path: string, folders: Pick<ProjectFolders, "bibleFolder">): boolean {
  const prefix = `${folders.bibleFolder}/`;
  return path.startsWith(prefix) && !path.startsWith(`${prefix}Tracking/`) && path !== `${prefix}suivi.md`
    && path.endsWith(".md") && !path.includes("\\") && path.split("/").every(part => part && part !== "." && part !== "..");
}

export function editorialObjectives(path: string, content: string): EditorialObjective[] {
  const body = content.replace(/<!-- orelius:priorities:start -->[\s\S]*?<!-- orelius:priorities:end -->/g, "");
  return [...body.matchAll(/^- \[(essentiel|secondaire|a-eviter|suspendu)\] (\S[^\r\n]*)$/gm)]
    .map(match => ({ path, level: match[1] as EditorialObjective["level"], goal: match[2]!.trim() }));
}

export function introducedObjectives(path: string, before: string, after: string, folders: ProjectFolders): EditorialObjective[] {
  if (!bibleReference(path, folders) || !path.startsWith(`${folders.bibleFolder}/Style/`)) return [];
  const old = editorialObjectives(path, before);
  return editorialObjectives(path, after).filter(goal => !old.some(item => item.goal === goal.goal && item.level === goal.level));
}

export const priorityHistoryPath = (path: string, folders: Pick<ProjectFolders, "bibleFolder">) => `Tracking/Priorities/${path.slice(folders.bibleFolder.length + 1)}`;

export function prioritySummary(path: string, content: string): { path: string; content: string; role: string } | null {
  const rows = content.match(/^- [+-]?\d+ — .+$/gm);
  return rows?.length ? { path, content: rows.join("\n"), role: "priority-evidence" } : null;
}

export async function rateEditorialObjectives(cwd: string, folders: ProjectFolders, objectives: EditorialObjective[],
  evidence: Evidence, checkEditor: (path: string, content: string) => void = () => {}): Promise<void> {
  for (const path of new Set(objectives.map(item => item.path))) {
    if (!bibleReference(path, folders)) throw new Error(t("priorityBibleOnly"));
    if (!path.startsWith(`${folders.bibleFolder}/Style/`)) continue;
    const reference = await readProjectFile(cwd, path);
    if (!reference) continue;
    const historyPath = priorityHistoryPath(path, folders);
    const previous = await readProjectFile(cwd, historyPath);
    const legacyStart = reference.text.indexOf(START), legacyEnd = reference.text.indexOf(END);
    if ((legacyStart < 0) !== (legacyEnd < 0) || legacyStart >= 0 && legacyEnd < legacyStart) throw new Error(t("priorityMarkersInvalid"));
    const legacy = legacyStart < 0 ? "" : reference.text.slice(legacyStart, legacyEnd + END.length);
    if (legacy && previous) throw new Error(t("priorityHistoryInvalid"));
    const file = previous ?? { ...reference, text: legacy };
    const start = file.text.indexOf(START), end = file.text.indexOf(END);
    let records: Record<string, RatedObjective> = {};
    if (start !== -1 || end !== -1) {
      if (start < 0 || end < start || start !== file.text.lastIndexOf(START) || end !== file.text.lastIndexOf(END)) throw new Error(t("priorityMarkersInvalid"));
      const saved = /^\n<!-- orelius:priorities-content:([a-f0-9]{64}) -->\n([\s\S]*)$/.exec(file.text.slice(start + START.length, end));
      if (!saved || key(saved[2]!) !== saved[1]) throw new Error(t("priorityManualChanges"));
      const encoded = /^Données : (.+)$/m.exec(saved[2]!)?.[1];
      const data: unknown = encoded ? JSON.parse(encoded) : null;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(t("priorityDataInvalid"));
      for (const [id, item] of Object.entries(data as Record<string, unknown>)) {
        if (!item || typeof item !== "object" || !("goal" in item) || typeof item.goal !== "string" || key(item.goal) !== id
          || !("evidence" in item) || !Array.isArray(item.evidence)) throw new Error(t("priorityHistoryInvalid"));
        for (const entry of item.evidence as unknown[]) {
          if (!entry || typeof entry !== "object" || !("subject" in entry) || typeof entry.subject !== "string"
            || !("value" in entry) || typeof entry.value !== "string" || !["up", "heart", "down"].includes(entry.value)
            || !("report" in entry) || typeof entry.report !== "string" || !("message" in entry) || typeof entry.message !== "string") throw new Error(t("priorityHistoryInvalid"));
        }
      }
      records = data as Record<string, RatedObjective>;
    }
    const current = editorialObjectives(path, reference.text);
    let changed = false;
    for (const goal of objectives.filter(item => item.path === path)) {
      if (!current.some(item => item.goal === goal.goal && item.level === goal.level)) continue;
      const id = key(goal.goal), record = records[id] ?? { goal: goal.goal, evidence: [] };
      const previous = record.evidence.find(item => item.subject === evidence.subject);
      if (JSON.stringify(previous) === JSON.stringify(evidence)) continue;
      record.evidence = [...record.evidence.filter(item => item.subject !== evidence.subject), evidence];
      records[id] = record;
      changed = true;
    }
    if (!changed && !legacy) continue;
    const score = (record: RatedObjective) => record.evidence.reduce((sum, item) => sum + (item.value === "heart" ? 2 : item.value === "up" ? 1 : -1), 0);
    const rows = Object.values(records).filter(record => current.some(item => item.goal === record.goal))
      .sort((a, b) => score(b) - score(a)).map(record => {
        const points = score(record);
        return `- ${points > 0 ? "+" : ""}${points} — ${record.goal}${record.evidence.some(item => item.value === "down") ? " — retour négatif à examiner" : ""}\n${record.evidence.map(item => `  - ${item.value} : [[${item.report}]]${item.message.trim() ? ` — ${JSON.stringify(item.message)}` : ""}`).join("\n")}`;
      }).join("\n");
    const body = `## Retours sur les priorités\n\n${rows}\n\nCes points concernent l’application de ces objectifs dans les échanges évalués, pas une preuve de causalité. Un rejet invite à revoir l’objectif ou son application ; il ne supprime ni fait établi ni interdiction explicite. Les consignes de l’auteur priment sur le score.\n\nDonnées : ${JSON.stringify(records)}\n`;
    const block = `${START}\n<!-- orelius:priorities-content:${key(body)} -->\n${body}${END}`;
    const content = start < 0 ? `${file.text}${file.text.endsWith("\n") ? "\n" : "\n\n"}${block}\n` : file.text.slice(0, start) + block + file.text.slice(end + END.length);
    await writeProjectFile(cwd, historyPath, content, previous, folders.archiveFolder, undefined, () => checkEditor(historyPath, previous?.text ?? ""));
    if (legacy) {
      const clean = reference.text.slice(0, legacyStart) + reference.text.slice(legacyEnd + END.length);
      await writeProjectFile(cwd, path, clean, reference, folders.archiveFolder, undefined, () => checkEditor(path, reference.text));
    }
  }
}

export function preservePriorityHistory(before: string, after: string): void {
  const start = before.indexOf(START), end = before.indexOf(END);
  if (start < 0 && end < 0) return;
  if (start < 0 || end < start || after.indexOf(START) !== after.lastIndexOf(START) || after.indexOf(END) !== after.lastIndexOf(END) || !after.includes(before.slice(start, end + END.length))) throw new Error(t("priorityHistoryPreserve"));
}
