import { editOutline, parseOutline, reconcileOutline, outlineRelations, type NovelOutline, type OutlineAction } from "./novel-outline.ts";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { readData } from "./narrative-context.ts";
import { projectSources, type ProjectSource } from "./project-sources.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import type { ProjectFolders } from "./settings.ts";

const kinds = { Seeds: "graine", Plan: "plan", Scenes: "scene", Personnages: "personnage", Intrigues: "intrigue", Arcs: "arc", Chapitres: "chapitre" } as const;
export type StoryKind = typeof kinds[keyof typeof kinds];
export type Decision = "propose" | "retenu" | "abandonne";
export interface StoryNode { id: string; kind: StoryKind; path: string; hash: string; missing: boolean; decision: Decision }
export interface StoryLink { from: string; to: string; relation: "developpe" | "planifie" | "implique" | "realise"; fromHash: string; toHash: string; quote?: string; at?: number }
export interface StoryStructure { version: 1; nodes: StoryNode[]; links: StoryLink[]; outline?: NovelOutline }
export const structurePath = (folders: ProjectFolders) => `${folders.manuscriptFolder}/Context/Structure.md`;
export function storyKind(path: string, folders: ProjectFolders): StoryKind | undefined {
  if (!/\.md$/i.test(path) || /\/index\.md$/i.test(path) || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) return;
  for (const [directory, kind] of Object.entries(kinds)) if (path.startsWith(`${folders.manuscriptFolder}/${directory}/`)) return kind;
  if (path.startsWith(`${folders.bibleFolder}/Personnages/`)) return "personnage";
  if (path.startsWith(`${folders.bibleFolder}/Intrigues/`)) return "intrigue";
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
function compatible(link: StoryLink, from: StoryNode, to: StoryNode): boolean {
  return link.relation === "developpe" && from.kind === "graine" && to.kind === "plan"
    || link.relation === "planifie" && from.kind === "plan" && to.kind === "scene"
    || link.relation === "implique" && ["personnage", "intrigue", "arc"].includes(from.kind) && to.kind === "scene"
    || link.relation === "realise" && from.kind === "scene" && to.kind === "chapitre";
}
export function parseStructure(value: unknown, folders: ProjectFolders): StoryStructure {
  const fail = () => { throw new Error("Structure narrative invalide ; registre conservé."); };
  if (!record(value) || !keys(value, ["version", "nodes", "links", "outline"]) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.links)) return fail();
  const ids = new Set<string>(), paths = new Set<string>();
  for (const node of value.nodes) {
    if (!record(node) || !keys(node, ["id", "kind", "path", "hash", "missing", "decision"]) || typeof node.id !== "string" || !/^[a-f0-9-]{36}$/.test(node.id)
      || typeof node.path !== "string" || !storyKind(node.path, folders) || node.kind !== storyKind(node.path, folders) || !hash(node.hash)
      || typeof node.missing !== "boolean" || !["propose", "retenu", "abandonne"].includes(String(node.decision)) || ids.has(node.id) || paths.has(node.path)) return fail();
    ids.add(node.id); paths.add(node.path);
  }
  const data = value as unknown as StoryStructure;
  const links = new Set<string>();
  for (const link of data.links) {
    if (!record(link) || !keys(link, ["from", "to", "relation", "fromHash", "toHash", "quote", "at"])) return fail();
    const from = data.nodes.find(node => node.id === link.from), to = data.nodes.find(node => node.id === link.to);
    if (!from || !to || !compatible(link, from, to) || !hash(link.fromHash) || !hash(link.toHash)) return fail();
    if (link.relation === "realise" ? typeof link.quote !== "string" || !link.quote.trim() || !Number.isSafeInteger(link.at) || link.at! < 0 : link.quote !== undefined || link.at !== undefined) return fail();
    const key = `${link.from}/${link.to}/${link.relation}`;
    if (links.has(key)) return fail();
    links.add(key);
  }
  if (data.outline !== undefined) parseOutline(data.outline, data);
  return data;
}
export function linkStatus(data: StoryStructure, link: StoryLink, sources: ProjectSource[]): string {
  const from = data.nodes.find(node => node.id === link.from)!, to = data.nodes.find(node => node.id === link.to)!;
  if (from.missing || to.missing) return "source absente";
  if (from.decision === "abandonne" || to.decision === "abandonne") return "abandonné";
  if (from.hash !== link.fromHash) return "à revalider";
  if (link.relation === "realise") {
    const text = sources.find(source => source.path === to.path)?.content ?? "";
    const quote = link.quote!;
    if (to.hash === link.toHash && text.slice(link.at, link.at! + quote.length) === quote) return "valide";
    const first = text.indexOf(quote);
    return first >= 0 && text.indexOf(quote, first + 1) < 0 ? "valide" : "à revalider";
  }
  return to.hash === link.toHash ? "valide" : "à revalider";
}
function reconcile(data: StoryStructure, sources: ProjectSource[], folders: ProjectFolders, rename?: { from: string; to: string }): void {
  const eligible = sources.filter(source => storyKind(source.path, folders));
  if (rename) for (const node of data.nodes) if (node.path === rename.from || node.path.startsWith(rename.from + "/")) {
    const path = rename.to + node.path.slice(rename.from.length);
    if (storyKind(path, folders) === node.kind && !data.nodes.some(other => other !== node && other.path === path)) node.path = path;
  }
  const missing = data.nodes.filter(node => !eligible.some(source => source.path === node.path));
  const added = eligible.filter(source => !data.nodes.some(node => node.path === source.path));
  for (const source of added) {
    const kind = storyKind(source.path, folders)!;
    const matches = missing.filter(node => node.hash === source.hash && node.kind === kind);
    if (matches.length === 1 && data.nodes.filter(node => node.hash === source.hash && node.kind === kind).length === 1
      && eligible.filter(other => other.hash === source.hash && storyKind(other.path, folders) === kind).length === 1) matches[0].path = source.path;
    else data.nodes.push({ id: randomUUID(), kind, path: source.path, hash: source.hash, missing: false, decision: "propose" });
  }
  for (const node of data.nodes) {
    const source = eligible.find(source => source.path === node.path);
    node.missing = !source;
    if (source) node.hash = source.hash;
  }
}
export interface StructureEdit { rename?: { from: string; to: string }; decision?: { path: string; value: Decision }; link?: unknown; outline?: { expected: string; action: OutlineAction } }
const queues = new Map<string, Promise<unknown>>();
export async function syncStructure(cwd: string, folders: ProjectFolders, edit: StructureEdit = {}, configDir?: string, ensureCurrent: () => void = () => {}): Promise<StoryStructure> {
  const root = await realpath(cwd);
  const previous = queues.get(root) ?? Promise.resolve();
  const action = previous.catch(() => {}).then(async () => {
    ensureCurrent();
    const path = structurePath(folders), file = await readProjectFile(root, path);
    const data: StoryStructure = file ? parseStructure(readData(file.text), folders) : { version: 1, nodes: [], links: [] };
    const sources = await projectSources(root, folders);
    reconcile(data, sources, folders, edit.rename);
    if (edit.outline) {
      if (JSON.stringify(data) !== edit.outline.expected) throw new Error("Le plan ou ses sources ont changé. Actualisez la vue avant de déplacer une scène.");
      editOutline(data, edit.outline.action);
    } else if (data.outline) data.outline = reconcileOutline(data);
    if (edit.decision) {
      const node = data.nodes.find(node => node.path === edit.decision!.path && !node.missing);
      if (!node || !["propose", "retenu", "abandonne"].includes(edit.decision.value)) throw new Error("Fiche ou décision invalide.");
      node.decision = edit.decision.value;
    }
    if (edit.link !== undefined) {
      if (!record(edit.link) || !keys(edit.link, ["from", "to", "relation", "fromHash", "toHash", "quote", "at", "remove"])) throw new Error("Arguments de liaison invalides.");
      const { remove, ...candidate } = edit.link;
      if (remove !== undefined && typeof remove !== "boolean") throw new Error("remove doit être un booléen.");
      const link = candidate as unknown as StoryLink;
      const index = data.links.findIndex(other => other.from === link.from && other.to === link.to && other.relation === link.relation);
      const from = data.nodes.find(node => node.id === link.from), to = data.nodes.find(node => node.id === link.to);
      if (!from || !to || !remove && (from.missing || to.missing) || from.hash !== link.fromHash || to.hash !== link.toHash) throw new Error("Sources modifiées ou absentes ; consultez de nouveau la structure.");
      const proposed = { ...data, links: index < 0 ? [...data.links, link] : data.links.map((previous, i) => i === index ? link : previous) };
      parseStructure(proposed, folders);
      if (remove) {
        if (index < 0) throw new Error("Lien absent.");
        data.links.splice(index, 1);
      } else {
        if (linkStatus(proposed, link, sources) !== "valide") throw new Error("Lien abandonné ou passage introuvable à la position indiquée.");
        if (link.relation === "realise") {
          const text = sources.find(source => source.path === to.path)!.content;
          if (text.slice(link.at, link.at! + link.quote!.length) !== link.quote) throw new Error("Citation absente à la position UTF-16 indiquée.");
        }
        data.links = proposed.links;
      }
    }
    const overview = data.nodes.map(node => `- ${node.kind} : ${node.path} — ${node.id} — ${node.missing ? "absent" : node.decision}`).join("\n");
    const links = data.links.map(link => `- ${link.from} → ${link.to} : ${link.relation} — ${linkStatus(data, link, sources)}`).join("\n");
    const outline = data.outline ? `\n\n## Plan du roman\n\n${data.outline.acts.map(act => `- Acte : ${act.title} — ${act.id}`).join("\n")}\n${data.outline.chapters.map(chapter => `- Chapitre : ${data.nodes.find(node => node.id === chapter.id)!.path} — acte ${chapter.act ?? "non attribué"}`).join("\n")}\n${data.outline.scenes.map(scene => `- Scène : ${data.nodes.find(node => node.id === scene.id)!.path} — chapitre ${scene.chapter ?? "non attribué"} — point de vue ${scene.pov || "non précisé"} — ${scene.status}`).join("\n")}` : "";
    const content = `# Structure narrative\n\nLes décisions sont celles de l’auteur ; les liens sont des propositions vérifiables, pas une preuve de qualité ni des faits du récit. Le bloc JSON fait foi. Les identifiants survivent aux renommages suivis par Orelius.\n\n${overview}\n\n## Liens\n\n${links || "Aucun lien enregistré."}${outline}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
    ensureCurrent();
    await writeProjectFile(root, path, content, file, folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
    return data;
  });
  queues.set(root, action);
  try { return await action; } finally { if (queues.get(root) === action) queues.delete(root); }
}
export function structureView(data: StoryStructure, sources: ProjectSource[]): object {
  return { ...data, placementRelations: outlineRelations(data), links: data.links.map(link => ({ ...link, status: linkStatus(data, link, sources) })) };
}
