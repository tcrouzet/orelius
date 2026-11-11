import { BRAINSTORM_INPUT } from "./brainstorm.ts";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { t } from "./i18n.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import type { ProjectFolders } from "./settings.ts";

export const INPUTS_PATH = "Tracking/Inputs.md";
const marker = "\n<!-- orelius:inputs:data -->\n";
export interface AuthorInput {
  id: string; date: string; text: string; threadId: string; turnId: string; source: string;
  status: "pending" | "integre" | "exploration" | "sans-impact";
  synthesis: string; references: { chemin: string; extrait: string }[];
}
const writes = new Map<string, Promise<unknown>>();
function parse(text: string): AuthorInput[] {
  const fail = (): never => { throw new Error(t("inputsInvalid")); };
  const start = text.lastIndexOf(marker);
  if (start < 0) return fail();
  let value: unknown;
  try { value = JSON.parse(text.slice(start + marker.length)); } catch { return fail(); }
  if (!Array.isArray(value)) return fail();
  const ids = new Set<string>();
  for (const row of value as AuthorInput[]) {
    if (!row || Object.keys(row).sort().join() !== "date,id,references,source,status,synthesis,text,threadId,turnId"
      || [row.id,row.date,row.text,row.threadId,row.turnId,row.source,row.synthesis].some(field => typeof field !== "string")
      || !row.id || !row.text.trim() || !Number.isFinite(Date.parse(row.date)) || ids.has(row.id)
      || !["pending","integre","exploration","sans-impact"].includes(row.status) || !Array.isArray(row.references)
      || row.status !== "pending" && !row.synthesis.trim() || row.status === "integre" && !row.references.length
      || row.references.some(ref => !ref || Object.keys(ref).sort().join() !== "chemin,extrait" || typeof ref.chemin !== "string" || typeof ref.extrait !== "string")) return fail();
    ids.add(row.id);
  }
  return value as AuthorInput[];
}
function render(rows: AuthorInput[]): string {
  return `# Inputs\n\n${rows.map(row => `## ${row.date} — ${row.id}\n\n${row.text}\n\n${row.status === "pending" ? t("inputsPending") : row.synthesis}${row.references.length ? `\n\n${row.references.map(ref => `- [${ref.chemin}](${encodeURI(`../${ref.chemin}`)})`).join("\n")}` : ""}`).join("\n\n")}\n${marker}${JSON.stringify(rows,null,2)}\n`;
}
async function editInputs(cwd: string, folders: ProjectFolders, edit: (rows: AuthorInput[]) => void | Promise<void>, configDir?: string, ensureCurrent: () => void = () => {}): Promise<void> {
  const root = await realpath(cwd);
  const task = (writes.get(root) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const previous = await readProjectFile(root, INPUTS_PATH);
    const rows = previous ? parse(previous.text) : [];
    await edit(rows);
    if (!rows.length && !previous) return;
    await writeProjectFile(root, INPUTS_PATH, render(rows), previous, folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
  });
  writes.set(root,task);
  try { await task; } finally { if (writes.get(root) === task) writes.delete(root); }
}
export async function recordInput(cwd: string, folders: ProjectFolders, text: string, id: string = randomUUID(), configDir?: string): Promise<string> {
  if (!text.trim()) return id;
  await editInputs(cwd,folders,rows => {
    const existing = rows.find(row => row.id === id);
    if (existing) { if (existing.text !== text) throw new Error(t("inputsInvalid")); return; }
    rows.push({id,date:new Date().toISOString(),text,threadId:"",turnId:"",source:"",status:text.startsWith(BRAINSTORM_INPUT)?"exploration":"pending",synthesis:text.startsWith(BRAINSTORM_INPUT)?t("brainstormExploration"):"",references:[]});
  },configDir);
  return id;
}
export async function bindInput(cwd: string, folders: ProjectFolders, id: string, threadId: string, turnId: string, configDir?: string): Promise<void> {
  await editInputs(cwd,folders,rows => {
    const row = rows.find(row => row.id === id);
    if (!row) throw new Error(t("inputsInvalid"));
    row.threadId = threadId; row.turnId = turnId;
  },configDir);
}
export async function importInputs(cwd: string, folders: ProjectFolders, inputs: {source: string; threadId: string; turnId: string; date: string; text: string}[]): Promise<void> {
  if (!inputs.length) return;
  await editInputs(cwd,folders,rows => {
    for (const input of inputs) {
      let row = rows.find(row => row.source === input.source);
      if (row) continue;
      row = rows.find(row => !row.source && row.threadId === input.threadId && row.turnId === input.turnId && row.text === input.text);
      if (row) row.source = input.source;
      else rows.push({id:randomUUID(),...input,status:input.text.startsWith(BRAINSTORM_INPUT)?"exploration":"pending",synthesis:input.text.startsWith(BRAINSTORM_INPUT)?t("brainstormExploration"):"",references:[]});
    }
    rows.sort((a,b) => a.date.localeCompare(b.date));
  });
}
export async function pendingInputs(cwd: string): Promise<AuthorInput[]> {
  const root = await realpath(cwd);
  await writes.get(root);
  const note = await readProjectFile(root,INPUTS_PATH);
  if (!note) return [];
  const pending: AuthorInput[] = [];
  const references = new Map<string, string | undefined>();
  for (const row of parse(note.text)) {
    if (row.status === "sans-impact" || row.text.startsWith(BRAINSTORM_INPUT)) continue;
    let stale = !row.references.length;
    for (const ref of row.references) {
      if (!references.has(ref.chemin)) references.set(ref.chemin, (await readProjectFile(root, ref.chemin))?.text);
      if (!ref.extrait.trim() || !references.get(ref.chemin)?.includes(ref.extrait)) stale = true;
    }
    if (row.status === "pending" || stale) pending.push({ ...row, status: "pending" });
  }
  return pending;
}
export async function analyseInputs(cwd: string, folders: ProjectFolders, args: Record<string,unknown>, ensureCurrent: () => void, configDir?: string): Promise<string> {
  if (!Object.keys(args).length) return JSON.stringify({fichier:INPUTS_PATH,enAttente:await pendingInputs(cwd)});
  if (Object.keys(args).some(key => key !== "analyses") || !Array.isArray(args.analyses) || !args.analyses.length) throw new Error(t("inputsInvalidAnalysis"));
  const analyses = args.analyses;
  await editInputs(cwd,folders,async rows => {
    const seen = new Set<string>();
    for (const value of analyses) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("inputsInvalidAnalysis"));
      const entry = value as {id:string;statut:AuthorInput["status"];synthese:string;references:AuthorInput["references"]};
      const row = rows.find(row => row.id === entry.id);
      if (!row || seen.has(entry.id) || Object.keys(entry).sort().join() !== "id,references,statut,synthese" || !["integre","exploration","sans-impact"].includes(entry.statut)
        || typeof entry.synthese !== "string" || !entry.synthese.trim() || !Array.isArray(entry.references) || entry.statut !== "sans-impact" && !entry.references.length) throw new Error(t("inputsInvalidAnalysis"));
      seen.add(entry.id);
      for (const ref of entry.references) {
        if (!ref || Object.keys(ref).sort().join() !== "chemin,extrait" || typeof ref.chemin !== "string" || typeof ref.extrait !== "string" || !ref.extrait.trim()
          || !/\.md$/i.test(ref.chemin) || ref.chemin.includes("\\") || ref.chemin.split("/").some(part => !part || part === "." || part === "..")
          || !ref.chemin.startsWith(folders.bibleFolder+"/")
          || !(await readProjectFile(cwd,ref.chemin))?.text.includes(ref.extrait)) throw new Error(t("inputsInvalidAnalysis"));
      }
      row.status = entry.statut; row.synthesis = entry.synthese; row.references = entry.references;
    }
  },configDir,ensureCurrent);
  return JSON.stringify({fichier:INPUTS_PATH,enAttente:await pendingInputs(cwd)});
}
