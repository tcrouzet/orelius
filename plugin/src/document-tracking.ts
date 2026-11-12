import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, realpath } from "node:fs/promises";
import { extname, join } from "node:path";
import { checkPath } from "./archives.ts";
import { object } from "./codex.ts";
import { t } from "./i18n.ts";
import { readData } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { validateProjectFolders, type ProjectFolders } from "./settings.ts";

const journalPath = "Tracking/Changements.md";
interface Version { hash: string; file: string }
export interface DocumentChange { id: string; date: string; path: string; before: Version | null; after: Version | null }
interface Journal { files: Record<string, Version>; changes: DocumentChange[] }
const pending = new Map<string, Promise<unknown>>();
const safePath = (path: string) => !path.startsWith("/") && !path.includes("\\") && path.split("/").every(part => part && !part.startsWith("."));
const version = (value: unknown): value is Version => {
  const item = object(value);
  return typeof item.hash === "string" && /^[a-f0-9]{64}$/.test(item.hash)
    && typeof item.file === "string" && item.file.startsWith("Tracking/Documents/") && safePath(item.file);
};

async function readJournal(cwd: string): Promise<Journal> {
  const file = await readProjectFile(cwd, journalPath);
  if (!file) return { files: {}, changes: [] };
  const data = object(readData(file.text));
  const files = object(data.files);
  if (!data.files || Array.isArray(data.files) || !Array.isArray(data.changes)
    || Object.entries(files).some(([path, entry]) => !safePath(path) || !version(entry))
    || data.changes.some(value => {
      const item = object(value);
      return typeof item.id !== "string" || typeof item.date !== "string" || !Number.isFinite(Date.parse(item.date))
        || typeof item.path !== "string" || !safePath(item.path)
        || item.before !== null && !version(item.before) || item.after !== null && !version(item.after);
    })) throw new Error(t("invalidDocumentTracking"));
  return { files: files as Record<string, Version>, changes: data.changes as DocumentChange[] };
}

async function bytes(root: string, path: string): Promise<Buffer | null> {
  await checkPath(root, join(root, path));
  let file;
  try { file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (object(error).code === "ENOENT") return null; throw error; }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(t("mustBeARegularFileWithoutLinks", { value1: path }));
    return await file.readFile();
  } finally { await file.close(); }
}

async function scan(root: string, folders: ProjectFolders): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const walk = async (directory: string): Promise<void> => {
    await checkPath(root, join(root, directory));
    let entries;
    try { entries = await readdir(join(root, directory), { withFileTypes: true }); }
    catch (error) { if (object(error).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.name.startsWith(".") || entry.isSymbolicLink() || path === journalPath || path === "Tracking/Documents") continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) { const content = await bytes(root, path); if (content) result.set(path, content); }
    }
  };
  for (const directory of [folders.manuscriptFolder, folders.bibleFolder, folders.modelFolder, "Brainstorm", "Tracking"]) await walk(directory);
  for (const path of ["config.md", "AGENTS.md"]) { const content = await bytes(root, path); if (content) result.set(path, content); }
  return result;
}

async function capture(cwd: string, folders: ProjectFolders, configDir?: string): Promise<DocumentChange[]> {
  validateProjectFolders(folders);
  const journal = await readJournal(cwd);
  const sources = await scan(cwd, folders);
  const changes: DocumentChange[] = [];
  for (const path of [...new Set([...Object.keys(journal.files), ...sources.keys()])].sort()) {
    const content = sources.get(path);
    const before = journal.files[path] ?? null;
    const hash = content === undefined ? null : createHash("sha256").update(content).digest("hex");
    if ((before?.hash ?? null) === hash) continue;
    let after: Version | null = null;
    if (content !== undefined && hash) {
      const extension = /^\.[a-z0-9]+$/i.test(extname(path)) ? extname(path).toLowerCase() : ".bin";
      const file = `Tracking/Documents/${hash}${extension}`;
      await checkPath(cwd, join(cwd, file), configDir);
      await mkdir(join(cwd, "Tracking/Documents"), { recursive: true });
      await checkPath(cwd, join(cwd, file), configDir);
      const existing = await bytes(cwd, file);
      if (existing && !existing.equals(content)) throw new Error(t("invalidDocumentTracking"));
      if (!existing) {
        const snapshot = await open(join(cwd, file), "wx", 0o600);
        try { await snapshot.writeFile(content); await snapshot.sync(); }
        finally { await snapshot.close(); }
      }
      after = { hash, file };
    }
    const change = { id: randomUUID(), date: new Date().toISOString(), path, before, after };
    changes.push(change);
    journal.changes.push(change);
    if (after) journal.files[path] = after;
    else delete journal.files[path];
  }
  if (changes.length) {
    const entries = journal.changes.map(change => `- ${change.date} — ${JSON.stringify(change.path)} — ${!change.before ? "ajout" : !change.after ? "suppression" : "modification"}${change.before ? ` · [avant](${change.before.file.slice("Tracking/".length)})` : ""}${change.after ? ` · [après](${change.after.file.slice("Tracking/".length)})` : ""}`).join("\n");
    const text = `# Changements des documents\n\n${entries}\n\n\`\`\`json\n${JSON.stringify(journal, null, 2)}\n\`\`\`\n`;
    await writeProjectFile(cwd, journalPath, text, await readProjectFile(cwd, journalPath), folders.archiveFolder,
      async () => [], undefined, false, undefined, configDir);
  }
  return changes;
}

export async function trackDocuments(cwd: string, folders: ProjectFolders, configDir?: string): Promise<DocumentChange[]> {
  const root = await realpath(cwd);
  const work = (pending.get(root) ?? Promise.resolve()).then(() => capture(root, folders, configDir));
  const settled = work.then(() => {}, () => {});
  pending.set(root, settled);
  try { return await work; }
  finally { if (pending.get(root) === settled) pending.delete(root); }
}

export async function waitForTracking(cwd: string): Promise<void> {
  await pending.get(await realpath(cwd));
}

export async function trackedText(cwd: string, hash: string): Promise<string | null> {
  const journal = await readJournal(cwd);
  const entry = journal.changes.flatMap(change => [change.after, change.before]).find(entry => entry?.hash === hash);
  return entry ? (await readProjectFile(cwd, entry.file))?.text ?? null : null;
}
