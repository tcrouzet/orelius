import { randomUUID } from "node:crypto";
import type { StoryStructure } from "./story-structure.ts";

export const SCENE_STATUSES = { planned: "À écrire", draft: "Brouillon", revise: "À réviser", finished: "Terminé" } as const;
export interface NovelOutline {
  acts: { id: string; title: string }[];
  chapters: { id: string; act: string | null }[];
  scenes: { id: string; chapter: string | null; pov: string; status: keyof typeof SCENE_STATUSES }[];
}
export type OutlineAction = { type: "initialize" } | { type: "act"; title: string; id?: string }
  | { type: "chapter"; id: string; act: string | null }
  | { type: "scene"; id: string; chapter: string | null; before: string | null; pov: string; status: keyof typeof SCENE_STATUSES };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keys = (value: object, names: string[]) => Object.keys(value).every(key => names.includes(key));
export function parseOutline(value: unknown, data: StoryStructure): NovelOutline {
  const fail = () => { throw new Error("Plan du roman invalide ; registre conservé."); };
  if (!record(value) || !keys(value, ["acts", "chapters", "scenes"]) || !Array.isArray(value.acts) || !Array.isArray(value.chapters) || !Array.isArray(value.scenes)) return fail();
  const acts = new Set<string>(), chapters = new Set<string>(), scenes = new Set<string>();
  for (const act of value.acts) {
    if (!record(act) || !keys(act, ["id", "title"]) || typeof act.id !== "string" || !/^[a-f0-9-]{36}$/.test(act.id) || acts.has(act.id)
      || typeof act.title !== "string" || !act.title.trim() || act.title.length > 200) return fail();
    acts.add(act.id);
  }
  for (const chapter of value.chapters) {
    if (!record(chapter) || !keys(chapter, ["id", "act"]) || typeof chapter.id !== "string" || chapters.has(chapter.id)
      || !data.nodes.some(node => node.id === chapter.id && node.kind === "chapitre") || chapter.act !== null && (typeof chapter.act !== "string" || !acts.has(chapter.act))) return fail();
    chapters.add(chapter.id);
  }
  for (const scene of value.scenes) {
    if (!record(scene) || !keys(scene, ["id", "chapter", "pov", "status"]) || typeof scene.id !== "string" || scenes.has(scene.id)
      || !data.nodes.some(node => node.id === scene.id && node.kind === "scene") || scene.chapter !== null && (typeof scene.chapter !== "string" || !chapters.has(scene.chapter))
      || typeof scene.pov !== "string" || scene.pov.length > 200 || typeof scene.status !== "string" || !Object.prototype.hasOwnProperty.call(SCENE_STATUSES, scene.status)) return fail();
    scenes.add(scene.id);
  }
  return value as unknown as NovelOutline;
}
export function reconcileOutline(data: StoryStructure): NovelOutline {
  const outline = data.outline ?? { acts: [], chapters: [], scenes: [] };
  for (const node of data.nodes) {
    if (node.kind === "chapitre" && !outline.chapters.some(chapter => chapter.id === node.id)) outline.chapters.push({ id: node.id, act: null });
  }
  for (const node of data.nodes) if (node.kind === "scene" && !outline.scenes.some(scene => scene.id === node.id)) {
    const chapters = data.links.filter(link => link.from === node.id && link.relation === "realise").map(link => link.to);
    outline.scenes.push({ id: node.id, chapter: chapters.length === 1 ? chapters[0] : null, pov: "", status: "planned" });
  }
  return outline;
}
export function editOutline(data: StoryStructure, action: OutlineAction): void {
  const outline = reconcileOutline(data);
  const available = (id: string, kind: string) => data.nodes.some(node => node.id === id && node.kind === kind && !node.missing);
  if (action.type === "act") {
    if (!action.title.trim() || action.title.length > 200) throw new Error("Donnez un titre d’acte de 1 à 200 caractères.");
    if (action.id) {
      const act = outline.acts.find(item => item.id === action.id);
      if (!act) throw new Error("Acte introuvable.");
      act.title = action.title.trim();
    } else outline.acts.push({ id: randomUUID(), title: action.title.trim() });
  } else if (action.type === "chapter") {
    const chapter = outline.chapters.find(item => item.id === action.id);
    if (!chapter || !available(action.id, "chapitre") || action.act !== null && !outline.acts.some(act => act.id === action.act)) throw new Error("Chapitre ou acte introuvable.");
    chapter.act = action.act;
  } else if (action.type === "scene") {
    const scene = outline.scenes.find(item => item.id === action.id);
    if (!scene || !available(action.id, "scene") || action.chapter !== null && !available(action.chapter, "chapitre")) throw new Error("Scène ou chapitre introuvable.");
    if (action.before === action.id || action.before !== null && !outline.scenes.some(item => item.id === action.before && item.chapter === action.chapter)) throw new Error("Position de scène invalide.");
    Object.assign(scene, { chapter: action.chapter, pov: action.pov.trim(), status: action.status });
    outline.scenes = outline.scenes.filter(item => item.id !== scene.id);
    const index = action.before === null ? outline.scenes.length : outline.scenes.findIndex(item => item.id === action.before);
    outline.scenes.splice(index, 0, scene);
  } else if (action.type !== "initialize") throw new Error("Action de plan inconnue.");
  data.outline = parseOutline(outline, data);
}
export function outlineRelations(data: StoryStructure): { from: string; to: string; relation: string; order: number }[] {
  const outline = data.outline;
  if (!outline) return [];
  return [
    ...outline.chapters.filter(chapter => chapter.act !== null).map(chapter => ({ from: chapter.act!, to: chapter.id, relation: "contient-chapitre", order: outline.chapters.filter(item => item.act === chapter.act).indexOf(chapter) })),
    ...outline.scenes.filter(scene => scene.chapter !== null).map(scene => ({ from: scene.id, to: scene.chapter!, relation: "situe-scene", order: outline.scenes.filter(item => item.chapter === scene.chapter).indexOf(scene) })),
  ];
}
