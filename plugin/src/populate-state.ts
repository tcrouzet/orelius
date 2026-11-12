import { t } from "./i18n.ts";
import { trackDocuments, trackedText } from "./document-tracking.ts";
import { projectSources, type ProjectSource } from "./project-sources.ts";
import { readData } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import type { ProjectFolders } from "./settings.ts";

const statePath = (folders: ProjectFolders) => `Tracking/Populate.md`;
export interface ModelSource extends ProjectSource { deleted?: boolean; previousHash?: string; previousContent?: string }
async function readState(cwd: string, folders: ProjectFolders) {
  const file = await readProjectFile(cwd, statePath(folders));
  const data: unknown = file ? readData(file.text) : { processed: {} };
  if (!data || typeof data !== "object" || !("processed" in data) || !data.processed || typeof data.processed !== "object" || Array.isArray(data.processed)) throw new Error(t("invalidPopulateState"));
  const processed = data.processed as Record<string, { hash: string; date: string }>;
  for (const [path, entry] of Object.entries(processed)) {
    if (!path.startsWith(`${folders.modelFolder}/`) || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")
      || !entry || typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash) || typeof entry.date !== "string" || !Number.isFinite(Date.parse(entry.date))) throw new Error(t("invalidPopulateState"));
  }
  return { file, processed };
}
export async function newModelSources(cwd: string, folders: ProjectFolders): Promise<ModelSource[]> {
  const { processed } = await readState(cwd, folders);
  const sources = await projectSources(cwd, folders, [folders.modelFolder]);
  const changes: ModelSource[] = [];
  for (const source of sources) {
    const previousHash = processed[source.path]?.hash;
    if (previousHash === source.hash) continue;
    changes.push({ ...source, ...(previousHash ? { previousHash, previousContent: await trackedText(cwd, previousHash) ?? undefined } : {}) });
  }
  const current = new Set(sources.map(source => source.path));
  for (const [path, previous] of Object.entries(processed)) if (!current.has(path)) {
    changes.push({ path, hash: previous.hash, content: "", deleted: true, previousHash: previous.hash,
      previousContent: await trackedText(cwd, previous.hash) ?? undefined });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path, "fr", { numeric: true }));
}
export async function markPopulated(cwd: string, folders: ProjectFolders, sources: ModelSource[], ensureCurrent: () => void, configDir?: string): Promise<void> {
  if (!sources.length) return;
  await trackDocuments(cwd, folders, configDir);
  const { file, processed } = await readState(cwd, folders);
  const date = new Date().toISOString();
  for (const source of sources) {
    if (source.deleted) delete processed[source.path];
    else processed[source.path] = { hash: source.hash, date };
  }
  const content = `# Populate\n\n${t("populateStateExplanation")}\n\n\`\`\`json\n${JSON.stringify({ processed }, null, 2)}\n\`\`\`\n`;
  await writeProjectFile(cwd, statePath(folders), content, file, folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
}
