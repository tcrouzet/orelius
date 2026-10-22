import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link, open, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { archiveChanges } from "./plugin/src/archives.ts";
import { type OreliusSettings, validateProjectFolders } from "./plugin/src/settings.ts";

type AgentSettings = Pick<OreliusSettings, "folder" | "archiveFolder" | "manuscriptFolder" | "bibleFolder">;
const START = "<!-- orelius:agent:start -->";
const END = "<!-- orelius:agent:end -->";

export function renderAgent(template: string, settings: AgentSettings): string {
  validateProjectFolders(settings);
  const variables = { folder: settings.folder || ".", archiveFolder: settings.archiveFolder,
    manuscriptFolder: settings.manuscriptFolder, bibleFolder: settings.bibleFolder };
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

async function readAgent(path: string): Promise<{ text: string; stat: Stats } | null> {
  let source;
  try { source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await source.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("AGENTS.md doit être un fichier ordinaire sans lien.");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await source.readFile());
    return { text, stat };
  } finally { await source.close(); }
}

export async function generateAgent(cwd: string, settings: AgentSettings, template: string): Promise<void> {
  const instructions = renderAgent(template, settings);
  const root = await realpath(cwd);
  const target = join(root, "AGENTS.md");
  const previous = await readAgent(target);
  const content = updateAgent(previous?.text ?? "", instructions);
  if (content === previous?.text) return;
  if (previous) {
    await archiveChanges(root, [{ path: "AGENTS.md", kind: { type: "update" } }], undefined, settings.archiveFolder);
  }
  const temporary = join(root, `.orelius-agent-${randomUUID()}.tmp`);
  const output = await open(temporary, "wx", previous ? previous.stat.mode & 0o777 : 0o600);
  try {
    try { await output.writeFile(content); await output.sync(); }
    finally { await output.close(); }
    if (previous) {
      const current = await readAgent(target);
      if (!current || current.text !== previous.text || current.stat.ino !== previous.stat.ino
        || current.stat.dev !== previous.stat.dev || current.stat.mtimeMs !== previous.stat.mtimeMs
        || current.stat.ctimeMs !== previous.stat.ctimeMs) {
        throw new Error("AGENTS.md a changé pendant la génération. Le fichier a été conservé.");
      }
      await rename(temporary, target);
    } else {
      // Linking publishes the complete file without replacing a newly created AGENTS.md.
      await link(temporary, target);
    }
  } finally { await rm(temporary, { force: true }); }
}
