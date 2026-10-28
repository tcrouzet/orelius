import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { archiveChanges, archiveGenerated, checkPath } from "./archives.ts";
import { checkRevision, type RevisionPlan } from "./revision.ts";

export interface ProjectFile { text: string; stat: Stats }

export async function readProjectFile(cwd: string, path: string): Promise<ProjectFile | null> {
  const root = await realpath(cwd);
  const target = resolve(root, path);
  await checkPath(root, target);
  let source;
  try { source = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await source.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${path} doit être un fichier ordinaire sans lien.`);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await source.readFile());
    return { text, stat };
  } finally { await source.close(); }
}

export async function writeProjectFile(cwd: string, path: string, content: string,
  previous: ProjectFile | null, archiveFolder: string, archive: typeof archiveChanges = archiveChanges,
  ensureCurrent: () => void = () => {}, archiveOutput = false, revision?: RevisionPlan, configDir?: string): Promise<string[]> {
  ensureCurrent();
  if (revision) checkRevision(revision, previous?.text, content);
  if (content === previous?.text) {
    if (!archiveOutput) return [];
    const archive = await archiveGenerated(cwd, path, content, archiveFolder, previous.stat.mode, configDir);
    ensureCurrent();
    return [archive];
  }
  const root = await realpath(cwd);
  const target = resolve(root, path);
  await checkPath(root, target, configDir);
  ensureCurrent();
  const archives = await archive(root, [{ path, kind: { type: previous ? "update" : "add" } }], undefined, archiveFolder, "", configDir);
  ensureCurrent();
  await mkdir(dirname(target), { recursive: true });
  await checkPath(root, target);
  const temporary = join(dirname(target), `.orelius-${randomUUID()}.tmp`);
  const output = await open(temporary, "wx", previous ? previous.stat.mode & 0o777 : 0o600);
  try {
    try { await output.writeFile(content); await output.sync(); }
    finally { await output.close(); }
    if (archiveOutput) archives.push(await archiveGenerated(root, path, content, archiveFolder, previous?.stat.mode, configDir));
    if (previous) {
      const current = await readProjectFile(root, path);
      if (!current || current.text !== previous.text || current.stat.ino !== previous.stat.ino
        || current.stat.dev !== previous.stat.dev || current.stat.mtimeMs !== previous.stat.mtimeMs
        || current.stat.ctimeMs !== previous.stat.ctimeMs) {
        throw new Error(`${path} a changé pendant la préparation. Le fichier a été conservé.`);
      }
      ensureCurrent();
      await rename(temporary, target);
    } else {
      ensureCurrent();
      await link(temporary, target);
    }
    return archives;
  } finally { await rm(temporary, { force: true }); }
}
