import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { checkPath } from "./archives.ts";
import { fingerprint, parseState, readData, statePath } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { chapterPath } from "./corrections.ts";
import type { ProjectFolders } from "./settings.ts";

export const MAINTENANCE_PREFIX = "[Orelius : actualisation interne du suivi]\n";
export interface PendingState { chapter: string; hash: string; reason: "absent" | "perime" }

export async function chapterFiles(cwd: string, folders: ProjectFolders): Promise<string[]> {
  const root = await realpath(cwd);
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    await checkPath(root, join(root, directory));
    let entries;
    try { entries = await readdir(join(root, directory), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(path);
    }
  }
  await walk(`${folders.manuscriptFolder}/Chapitres`);
  return result.sort(new Intl.Collator("fr", { numeric: true }).compare);
}

export async function pendingStates(cwd: string, folders: ProjectFolders, chapters?: string[]): Promise<PendingState[]> {
  const pending: PendingState[] = [];
  for (const chapter of chapters ?? await chapterFiles(cwd, folders)) {
    if (chapterPath(cwd, folders, chapter) !== chapter) throw new Error("Chapitre invalide dans le suivi.");
    const manuscript = await readProjectFile(cwd, chapter);
    if (!manuscript?.text.trim()) continue;
    const note = await readProjectFile(cwd, statePath(folders, chapter));
    let current = false;
    if (note) try {
      const state = parseState(readData(note.text), chapter, manuscript.text);
      current = true;
      for (const [path, hash] of Object.entries(state.dependencies ?? {})) {
        if (fingerprint((await readProjectFile(cwd, path))?.text ?? "") !== hash) current = false;
      }
    } catch { current = false; }
    if (!current) pending.push({ chapter, hash: fingerprint(manuscript.text), reason: note ? "perime" : "absent" });
  }
  return pending;
}

export async function saveWorkflow(cwd: string, folders: ProjectFolders, pending: PendingState[], ensureCurrent: () => void = () => {}, configDir?: string): Promise<void> {
  const path = `${folders.manuscriptFolder}/Context/suivi-etats.md`;
  const content = `# Suivi des états narratifs\n\n${pending.length ? "États à extraire depuis le texte conservé. Aucun de ces états n’est considéré comme à jour." : "Tous les chapitres examinés disposent d’un état lié au texte conservé. Cela ne valide pas l’interprétation littéraire."}\n\n\`\`\`json\n${JSON.stringify(pending, null, 2)}\n\`\`\`\n`;
  await writeProjectFile(cwd, path, content, await readProjectFile(cwd, path), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
}

export function maintenancePrompt(pending: PendingState[]): string {
  return MAINTENANCE_PREFIX + "Actualise uniquement les états narratifs des chapitres listés. Aucun texte du manuscrit, de la Bible, du plan ou des prompts ne doit être modifié. Pour chaque chapitre : consulter_contexte_editorial depuis page 0, lire toutes les pages, puis enregistrer_etat_narratif depuis le texte conservé avec son empreinte, des citations exactes et les détenteurs de connaissance. Ne prépare ni ne rédige de prose. Signale toute impossibilité ; ne prétends pas que le suivi est complet.\n\n" + JSON.stringify(pending);
}
