import { t } from "./i18n.ts";
import { projectSources, type ProjectSource } from "./project-sources.ts";
import { readData } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import type { ProjectFolders } from "./settings.ts";

const statePath = (folders: ProjectFolders) => `${folders.manuscriptFolder}/Context/Populate.md`;
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
export async function newModelSources(cwd: string, folders: ProjectFolders): Promise<ProjectSource[]> {
  const { processed } = await readState(cwd, folders);
  return projectSources(cwd, folders, [folders.modelFolder], new Set(Object.keys(processed)));
}
export async function markPopulated(cwd: string, folders: ProjectFolders, sources: ProjectSource[], ensureCurrent: () => void, configDir?: string): Promise<void> {
  if (!sources.length) return;
  const { file, processed } = await readState(cwd, folders);
  const date = new Date().toISOString();
  for (const source of sources) processed[source.path] = { hash: source.hash, date };
  const content = `# Populate\n\n${t("populateStateExplanation")}\n\n\`\`\`json\n${JSON.stringify({ processed }, null, 2)}\n\`\`\`\n`;
  await writeProjectFile(cwd, statePath(folders), content, file, folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
}
