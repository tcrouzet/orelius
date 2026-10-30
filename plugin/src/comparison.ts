import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { checkPath } from "./archives.ts";
import { chapterPath } from "./corrections.ts";
import { diffToGroups } from "./diff.ts";
import { statePath } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile, type ProjectFile } from "./project-files.ts";
import type { RevisionPlan } from "./revision.ts";
import { validateProjectFolders, type ProjectFolders } from "./settings.ts";

export interface ComparisonVersion { label: string; text: string; archive?: string; base?: string }
const proposalDirectory = (folders: ProjectFolders, chapter: string) => `${dirname(statePath(folders, chapter))}/Variantes`;
export function mergeComparison(before: string, after: string, selected: ReadonlySet<number>): string {
  const changes = diffToGroups(before, after);
  if ([...selected].some(index => !Number.isSafeInteger(index) || index < 0 || index >= changes.length)) throw new Error("Choix de modification invalide.");
  let result = before;
  for (let i = changes.length - 1; i >= 0; i--) if (selected.has(i)) {
    const change = changes[i];
    result = result.slice(0, change.delFrom) + (change.insText ?? "") + result.slice(change.delTo);
  }
  return result;
}
export async function saveVariants(cwd: string, folders: ProjectFolders, revision: RevisionPlan | null | undefined, args: Record<string, unknown>, ensureCurrent: () => void, configDir?: string): Promise<string> {
  validateProjectFolders(folders);
  if (!revision?.selection?.readOnly || chapterPath(cwd, folders, revision.path) !== revision.path) throw new Error("Demandez des variantes sur une sélection du chapitre.");
  if (Object.keys(args).some(key => key !== "variantes") || !Array.isArray(args.variantes) || args.variantes.length < 2 || args.variantes.length > 3) throw new Error("Fournissez deux ou trois variantes.");
  const variants = args.variantes.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Variante invalide.");
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some(key => !["titre", "texte"].includes(key)) || typeof item.titre !== "string" || !item.titre.trim() || item.titre.length > 200 || typeof item.texte !== "string" || !item.texte.trim() || item.texte.length > 200_000) throw new Error("Titre ou texte de variante invalide.");
    return { label: item.titre, text: revision.source.slice(0, revision.selection!.from) + item.texte + revision.source.slice(revision.selection!.to) };
  });
  const source = await readProjectFile(cwd, revision.path);
  if (source?.text !== revision.source) throw new Error("Le chapitre a changé depuis la sélection.");
  ensureCurrent();
  const path = `${proposalDirectory(folders, revision.path)}/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.md`;
  const bundle = { chapter: revision.path, base: revision.source, variants };
  const content = `# Variantes à comparer\n\nPropositions non acceptées. Le chapitre reste inchangé.\n\n${variants.map(item => `## ${item.label}\n\n${item.text}`).join("\n\n")}\n\n<!-- orelius:variants -->\n${JSON.stringify(bundle)}\n`;
  await writeProjectFile(cwd, path, content, null, folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
  return `Variantes enregistrées : ${path}. Ouvrez « Comparer les versions » pour choisir. Le chapitre reste inchangé.`;
}
async function names(cwd: string, directory: string): Promise<string[]> {
  await checkPath(cwd, resolve(cwd, directory));
  try { return (await readdir(join(cwd, directory), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort().reverse(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export async function comparisonVersions(cwd: string, folders: ProjectFolders, chapter: string, current: string): Promise<ComparisonVersion[]> {
  validateProjectFolders(folders);
  if (chapterPath(cwd, folders, chapter) !== chapter) throw new Error("Ouvrez un chapitre du manuscrit.");
  const versions: ComparisonVersion[] = [{ label: "Texte actuel", text: current }];
  const directory = proposalDirectory(folders, chapter);
  for (const name of await names(cwd, directory)) {
    if (!name.endsWith(".md")) continue;
    const file = await readProjectFile(cwd, `${directory}/${name}`);
    const marker = "\n<!-- orelius:variants -->\n", index = file?.text.lastIndexOf(marker) ?? -1;
    if (!file || index < 0) continue;
    let value: unknown;
    try { value = JSON.parse(file.text.slice(index + marker.length)); } catch { continue; }
    if (!value || typeof value !== "object") continue;
    const bundle = value as { chapter?: unknown; base?: unknown; variants?: unknown };
    if (bundle.chapter !== chapter || typeof bundle.base !== "string" || !Array.isArray(bundle.variants)) continue;
    for (const item of bundle.variants) {
      if (!item || typeof item !== "object" || typeof item.label !== "string" || typeof item.text !== "string") continue;
      versions.push({ label: `${item.label} — ${name.slice(0, 19)}${bundle.base !== current ? " (ancienne version)" : ""}`, text: item.text, base: bundle.base });
    }
  }
  const archiveDirectory = `${folders.archiveFolder}/${dirname(chapter)}`, extension = extname(chapter), stem = basename(chapter, extension);
  for (const name of await names(cwd, archiveDirectory)) {
    if (!name.startsWith(stem + ".") || !name.endsWith(extension) || !/^\d{4}-\d{2}-\d{2}T/.test(name.slice(stem.length + 1))) continue;
    const archive = `${archiveDirectory}/${name}`, file = await readProjectFile(cwd, archive);
    if (file) versions.push({ label: `Archive — ${name.slice(stem.length + 1)}`, text: file.text, archive });
  }
  return versions;
}

export async function applyComparison(cwd: string, folders: ProjectFolders, chapter: string, previous: ProjectFile, content: string,
  ensureCurrent: () => void, archive?: Parameters<typeof writeProjectFile>[5], configDir?: string): Promise<string[]> {
  validateProjectFolders(folders);
  if (chapterPath(cwd, folders, chapter) !== chapter) throw new Error("Ouvrez un chapitre du manuscrit.");
  const current = await readProjectFile(cwd, chapter);
  if (!current || current.text !== previous.text || current.stat.ino !== previous.stat.ino || current.stat.mtimeMs !== previous.stat.mtimeMs || current.stat.ctimeMs !== previous.stat.ctimeMs) throw new Error("Le chapitre a changé depuis l’ouverture de la comparaison. Fermez puis rouvrez la comparaison.");
  return writeProjectFile(cwd, chapter, content, previous, folders.archiveFolder, archive, ensureCurrent, true, undefined, configDir);
}
