import { createHash } from "node:crypto";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import type { ProjectFolders } from "./settings.ts";

export const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex");
export interface Reference {
  path: string; name?: string; aliases?: string[]; exclude?: string[];
  mode?: "auto" | "always" | "manual" | "hidden"; track?: boolean; caseSensitive?: boolean;
  priority?: number; secondary?: string[]; secondaryMode?: "all" | "any" | "none";
  role?: "knowledge" | "style" | "example"; children?: string[]; hiddenSections?: string[];
}
export interface ChapterLink { path: string; previous?: string | null; pov?: string; tense?: string; include?: boolean; references?: string[]; plan?: string; model?: string; act?: string }
export interface MethodPreset { instructions?: string; persona?: string; targetWords?: number }
export interface NarrativeConfig { methods?: Record<string, MethodPreset>; chapters: ChapterLink[]; references: Reference[]; maxCharacters?: number; referenceBudget?: number; recursiveReferences?: boolean }
export const EMPTY_CONFIG: NarrativeConfig = { chapters: [], references: [] };
export const configPath = (folders: ProjectFolders) => `${folders.manuscriptFolder}/Context/configuration.md`;
export const statePath = (folders: ProjectFolders, chapter: string) => `${folders.manuscriptFolder}/Context/${chapter.slice(`${folders.manuscriptFolder}/Chapitres/`.length).replace(/\.md$/i, "")}/etat.md`;
export function readData(text: string): unknown {
  const matches = [...text.matchAll(/^```json\s*\r?\n([\s\S]*?)^```\s*$/gm)];
  if (matches.length !== 1) throw new Error("Un seul bloc JSON est attendu dans la note structurée.");
  return JSON.parse(matches[0][1]);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Objet narratif attendu.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Texte narratif non vide attendu.");
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Liste narrative attendue.");
  return value.map(text);
}
function path(value: unknown): string {
  const result = text(value);
  if (result.startsWith("/") || result.includes("\\") || result.includes("\0") || result.split("/").some(p => !p || p === "." || p === "..") || !/\.md$/i.test(result)) throw new Error("Chemin Markdown relatif attendu.");
  return result;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Champ narratif inconnu.");
}
export function parseConfig(value: unknown, folders: ProjectFolders): NarrativeConfig {
  const root = record(value);
  keys(root, ["chapters", "references", "maxCharacters", "methods", "referenceBudget", "recursiveReferences"]);
  if (!Array.isArray(root.chapters) || !Array.isArray(root.references)) throw new Error("chapters et references sont requis.");
  const chapters = root.chapters.map(value => {
    const item = record(value);
    keys(item, ["path", "previous", "pov", "tense", "include", "references", "plan", "model", "act"]);
    const chapter = path(item.path);
    if (!chapter.startsWith(`${folders.manuscriptFolder}/Chapitres/`)) throw new Error("Chapitre hors Manuscript/Chapitres.");
    for (const field of ["pov", "tense", "act"]) if (item[field] !== undefined) text(item[field]);
    for (const field of ["previous", "plan", "model"]) if (item[field] !== undefined && item[field] !== null) path(item[field]);
    if (item.include !== undefined && typeof item.include !== "boolean") throw new Error("include doit être un booléen.");
    if (item.references !== undefined) strings(item.references).forEach(path);
    return item as unknown as ChapterLink;
  });
  const references = root.references.map(value => {
    const item = record(value);
    keys(item, ["path", "name", "aliases", "exclude", "mode", "track", "caseSensitive", "role", "children", "hiddenSections", "priority", "secondary", "secondaryMode"]);
    path(item.path);
    if (item.name !== undefined) text(item.name);
    for (const field of ["aliases", "exclude", "children", "hiddenSections", "secondary"]) if (item[field] !== undefined) strings(item[field]);
    if (item.priority !== undefined && (!Number.isSafeInteger(item.priority) || Math.abs(Number(item.priority)) > 100000)) throw new Error("Priorité invalide.");
    if (item.secondaryMode !== undefined && !["all", "any", "none"].includes(String(item.secondaryMode))) throw new Error("Condition secondaire invalide.");
    if (item.children) strings(item.children).forEach(path);
    if (item.mode !== undefined && !["auto", "always", "manual", "hidden"].includes(String(item.mode))) throw new Error("Mode de référence invalide.");
    if (item.role !== undefined && !["knowledge", "style", "example"].includes(String(item.role))) throw new Error("Rôle de référence invalide.");
    for (const field of ["track", "caseSensitive"]) if (item[field] !== undefined && typeof item[field] !== "boolean") throw new Error("Indicateur de référence invalide.");
    return item as unknown as Reference;
  });
  for (const list of [chapters, references]) if (new Set(list.map(r => r.path)).size !== list.length) throw new Error("Chemin narratif dupliqué.");
  const methods: Record<string, MethodPreset> = Object.create(null);
  if (root.methods !== undefined) for (const [name, value] of Object.entries(record(root.methods))) {
    const preset = record(value);
    keys(preset, ["instructions", "persona", "targetWords"]);
    for (const field of ["instructions", "persona"]) if (preset[field] !== undefined) text(preset[field]);
    if (preset.targetWords !== undefined && (!Number.isSafeInteger(preset.targetWords) || Number(preset.targetWords) < 1)) throw new Error("Longueur cible positive attendue.");
    methods[name] = preset as MethodPreset;
  }
  const chapterNames = new Set(chapters.map(c => c.path));
  for (const chapter of chapters) {
    const visited = new Set([chapter.path]);
    let previous = chapter.previous;
    while (previous) {
      if (!chapterNames.has(previous) || visited.has(previous) || chapters.findIndex(c => c.path === previous) >= chapters.indexOf(chapter)) throw new Error("Prédécesseur inconnu ou cycle narratif.");
      visited.add(previous);
      previous = chapters.find(c => c.path === previous)?.previous;
    }
  }
  if (root.maxCharacters !== undefined && (!Number.isSafeInteger(root.maxCharacters) || Number(root.maxCharacters) < 1000)) throw new Error("Budget de contexte invalide (caractères, minimum 1000).");
  if (root.referenceBudget !== undefined && (!Number.isSafeInteger(root.referenceBudget) || Number(root.referenceBudget) < 0)) throw new Error("Budget de références invalide.");
  if (root.recursiveReferences !== undefined && typeof root.recursiveReferences !== "boolean") throw new Error("recursiveReferences doit être un booléen.");
  return { chapters, references, methods, referenceBudget: root.referenceBudget as number | undefined, recursiveReferences: root.recursiveReferences as boolean | undefined, ...(root.maxCharacters === undefined ? {} : { maxCharacters: Number(root.maxCharacters) }) };
}
export function selectReferences(references: Reference[], selection: string, explicit: string[]): { selected: Reference[]; mentions: string[] } {
  const selected = new Map<string, Reference>();
  const mentions: string[] = [];
  const normalize = (value: string, sensitive?: boolean) => sensitive ? value.normalize("NFC") : value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const match = (value: string, name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(value);
  };
  const visit = (reference: Reference) => {
    if (reference.mode === "hidden" || selected.has(reference.path)) return;
    selected.set(reference.path, reference);
    for (const child of reference.children ?? []) {
      const found = references.find(r => r.path === child);
      if (!found) throw new Error(`Référence enfant introuvable : ${child}`);
      visit(found);
    }
  };
  for (const reference of references) {
    const value = normalize(selection, reference.caseSensitive);
    const secondary = (reference.secondary ?? []).map(key => match(value, normalize(key, reference.caseSensitive)));
    const condition = !secondary.length || (reference.secondaryMode === "all" ? secondary.every(Boolean) : reference.secondaryMode === "none" ? secondary.every(found => !found) : secondary.some(Boolean));
    const detected = condition && reference.track !== false && [reference.name ?? reference.path.split("/").pop()!.replace(/\.md$/i, ""), ...(reference.aliases ?? [])]
      .some(name => match(value, normalize(name, reference.caseSensitive))) && !(reference.exclude ?? []).some(name => match(value, normalize(name, reference.caseSensitive)));
    if (detected && reference.mode !== "hidden") mentions.push(reference.path);
    if (reference.mode === "always" || explicit.includes(reference.path) || detected && (reference.mode ?? "auto") === "auto") visit(reference);
  }
  for (const requested of explicit) if (!references.some(r => r.path === requested)) throw new Error(`Référence explicite inconnue : ${requested}`);
  return { selected: [...selected.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)), mentions };
}
export function visibleSections(content: string, hidden: string[]): string {
  const lines = content.split("\n");
  let hiddenLevel = 0;
  return lines.filter(line => {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (hiddenLevel && heading[1].length <= hiddenLevel) hiddenLevel = 0;
      if (hidden.includes(heading[2])) hiddenLevel = heading[1].length;
    }
    return !hiddenLevel;
  }).join("\n");
}

export interface NarrativeState {
  chapter: string; hash: string; summary: string; dependencies?: Record<string, string>;
  facts: { entity: string; field: string; value: string; quote: string; mode: "append" | "replace"; knownBy: string[]; at?: number }[];
  moments: { id: string; description: string; quote: string; after?: string; offset?: number; at?: number; duration?: number; unit?: "seconds" | "minutes" | "hours" | "days" }[];
}
export function parseState(value: unknown, chapter: string, manuscript: string): NarrativeState {
  const data = record(value);
  keys(data, ["chapter", "hash", "summary", "facts", "moments", "dependencies"]);
  if (data.chapter !== chapter || data.hash !== fingerprint(manuscript)) throw new Error("État narratif périmé : extraire à nouveau depuis le texte conservé.");
  text(data.summary);
  if (!Array.isArray(data.facts) || !Array.isArray(data.moments)) throw new Error("Faits et moments requis.");
  const cite = (quote: unknown) => { if (!manuscript.includes(text(quote))) throw new Error("Citation absente du manuscrit conservé."); };
  const facts = data.facts.map(value => {
    const item = record(value);
    keys(item, ["entity", "field", "value", "quote", "mode", "knownBy", "at"]);
    path(item.entity); text(item.field); text(item.value); cite(item.quote); strings(item.knownBy);
    if (!["append", "replace"].includes(String(item.mode))) throw new Error("Progression append ou replace attendue.");
    const quote = String(item.quote);
    const at = item.at ?? manuscript.indexOf(quote) + quote.length;
    if (!Number.isSafeInteger(at) || Number(at) < quote.length || manuscript.slice(Number(at) - quote.length, Number(at)) !== quote) throw new Error("Position de fait invalide.");
    if (item.at === undefined && manuscript.indexOf(quote) !== manuscript.lastIndexOf(quote)) throw new Error("Citation ambiguë : préciser at (fin de citation UTF-16) ou fournir une citation unique.");
    return { ...item, at } as unknown as NarrativeState["facts"][number];
  });
  const moments = data.moments.map(value => {
    const item = record(value);
    keys(item, ["id", "description", "quote", "after", "offset", "at", "duration", "unit"]);
    text(item.id); text(item.description); cite(item.quote);
    if (item.after !== undefined) text(item.after);
    if (item.offset !== undefined && (typeof item.offset !== "number" || !Number.isFinite(item.offset))) throw new Error("Décalage temporel numérique attendu.");
    for (const field of ["at", "duration"]) if (item[field] !== undefined && (typeof item[field] !== "number" || !Number.isFinite(item[field]) || field === "duration" && Number(item[field]) < 0)) throw new Error("Date ou durée invalide.");
    if (item.unit !== undefined && !["seconds", "minutes", "hours", "days"].includes(String(item.unit))) throw new Error("Unité temporelle invalide.");
    return item as unknown as NarrativeState["moments"][number];
  });
  if (new Set(moments.map(m => m.id)).size !== moments.length) throw new Error("Moment dupliqué.");
  for (const moment of moments) {
    const visited = new Set<string>();
    let current: typeof moment | undefined = moment;
    while (current) {
      if (visited.has(current.id)) throw new Error("Cycle temporel dans les moments.");
      visited.add(current.id);
      if (!current.after || current.after.includes("#")) break;
      const parent: typeof moment | undefined = moments.find(m => m.id === current!.after);
      if (!parent) throw new Error("Référence temporelle inconnue.");
      current = parent;
    }
  }
  const dependencies: Record<string, string> = Object.create(null);
  if (data.dependencies !== undefined) for (const [file, hash] of Object.entries(record(data.dependencies))) {
    path(file);
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Empreinte de dépendance invalide.");
    dependencies[file] = hash;
  }
  return { chapter, hash: data.hash as string, summary: data.summary as string, facts, moments, dependencies };
}
export function projectStates(states: NarrativeState[], references: Reference[]): { entity: string; field: string; value: string; knownBy: string[]; chapter: string }[] {
  const result: ReturnType<typeof projectStates> = [];
  for (const state of states) for (const fact of state.facts) {
    const reference = references.find(r => r.path === fact.entity);
    if (!reference || reference.mode === "hidden" || reference.hiddenSections?.includes(fact.field)) continue;
    if (fact.mode === "replace") for (let i = result.length - 1; i >= 0; i--) if (result[i].entity === fact.entity && result[i].field === fact.field) result.splice(i, 1);
    result.push({ entity: fact.entity, field: fact.field, value: fact.value, knownBy: fact.knownBy, chapter: state.chapter });
  }
  return result;
}
export async function ensureNarrativeConfig(cwd: string, folders: ProjectFolders, ensureCurrent: () => void, configDir?: string): Promise<void> {
  const file = configPath(folders);
  if (await readProjectFile(cwd, file)) return;
  await writeProjectFile(cwd, file, `# Configuration du contexte\n\nOrdre explicite des chapitres et références de connaissance, style et exemples. Une liste vide conserve l’ordre des noms de fichiers. Voir le guide du plugin pour les champs disponibles.\n\n\`\`\`json\n${JSON.stringify(EMPTY_CONFIG, null, 2)}\n\`\`\`\n`, null, folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
}
