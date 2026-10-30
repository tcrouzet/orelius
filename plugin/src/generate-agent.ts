import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { EDITORIAL_PRIORITIES } from "./bible.ts";
import { type OreliusSettings, validateProjectFolders } from "./settings.ts";

type AgentSettings = Pick<OreliusSettings, "folder" | "archiveFolder" | "manuscriptFolder" | "modelFolder" | "bibleFolder">;
const START = "<!-- orelius:agent:start -->";
const END = "<!-- orelius:agent:end -->";

export function renderAgent(template: string, settings: AgentSettings): string {
  validateProjectFolders(settings);
  const variables = { folder: settings.folder || ".", archiveFolder: settings.archiveFolder,
    manuscriptFolder: settings.manuscriptFolder, modelFolder: settings.modelFolder, bibleFolder: settings.bibleFolder,
    editorialPriorities: EDITORIAL_PRIORITIES };
  const result = template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) throw new Error(`Variable d’agent inconnue : {${key}}.`);
    return variables[key as keyof typeof variables];
  }).trimEnd();
  if (!result.trim() || result.includes(START) || result.includes(END)) throw new Error("Modèle d’agent vide ou contenant des marqueurs réservés.");
  return result;
}

function updateAgent(original: string, instructions: string): string {
  const block = `${START}\n${instructions}\n${END}`;
  const start = original.indexOf(START);
  const end = original.indexOf(END);
  if (start === -1 && end === -1) {
    const separator = original ? (original.endsWith("\n") ? "\n" : "\n\n") : "";
    return `${original}${separator}${block}\n`;
  }
  if (start === -1 || end < start || start !== original.lastIndexOf(START) || end !== original.lastIndexOf(END)) {
    throw new Error("Les marqueurs Orelius de AGENTS.md sont incomplets ou dupliqués. Le fichier a été conservé.");
  }
  return original.slice(0, start) + block + original.slice(end + END.length);
}

export async function generateAgent(cwd: string, settings: AgentSettings, template: string): Promise<void> {
  const instructions = renderAgent(template, settings);
  const previous = await readProjectFile(cwd, "AGENTS.md");
  const content = updateAgent(previous?.text ?? "", instructions);
  await writeProjectFile(cwd, "AGENTS.md", content, previous, settings.archiveFolder);
}
