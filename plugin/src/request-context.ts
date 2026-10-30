import type { ProjectFolders } from "./settings.ts";
import type { StoryStructure } from "./story-structure.ts";

export interface ContextChoice { chapter: string | null; include: string[]; exclude: string[] }
const START = "\n\n<!-- orelius:request-context -->\n", END = "\n<!-- /orelius:request-context -->";
export function contextChoice(text: string): ContextChoice | null {
  const start = text.indexOf(START);
  if (start < 0) return null;
  const end = text.indexOf(END, start);
  if (end < 0 || text.indexOf(START, start + START.length) >= 0) throw new Error("Choix de contexte incomplets ou dupliqués.");
  const value: unknown = JSON.parse(text.slice(start + START.length, end));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choix de contexte invalides.");
  const choice = value as ContextChoice;
  const path = (value: unknown): value is string => typeof value === "string" && !value.includes("\\") && !value.includes("\0") && value.split("/").every(part => part && part !== "." && part !== "..") && /\.md$/i.test(value);
  if (Object.keys(choice).some(key => !["chapter", "include", "exclude"].includes(key)) || choice.chapter !== null && !path(choice.chapter)
    || !Array.isArray(choice.include) || !Array.isArray(choice.exclude) || [...choice.include, ...choice.exclude].some(value => !path(value))
    || new Set([...choice.include, ...choice.exclude]).size !== choice.include.length + choice.exclude.length) throw new Error("Choix de contexte invalides.");
  return choice;
}
export function withoutContext(text: string): string {
  if (!contextChoice(text)) return text;
  const start = text.indexOf(START), end = text.indexOf(END, start);
  return text.slice(0, start) + text.slice(end + END.length);
}
export function withContext(text: string, choice: ContextChoice | null): string {
  if (!choice) return text;
  const result = withoutContext(text) + START + JSON.stringify(choice) + END;
  contextChoice(result);
  return result;
}
export function validateContextChoice(choice: ContextChoice | null, folders: ProjectFolders, chapter?: string): void {
  if (!choice) return;
  contextChoice(withContext("", choice));
  if (choice.chapter && chapter && choice.chapter !== chapter) throw new Error("Ces choix de contexte concernent un autre chapitre. Rouvrez Contexte.");
  const required = [chapter, `${folders.manuscriptFolder}/Context/Structure.md`, `${folders.manuscriptFolder}/Context/configuration.md`];
  for (const path of [...choice.include, ...choice.exclude]) {
    if (![folders.manuscriptFolder, folders.modelFolder, folders.bibleFolder].some(folder => path.startsWith(folder + "/"))) throw new Error(`Note hors du projet éditorial : ${path}`);
    if (choice.exclude.includes(path) && required.includes(path)) throw new Error(`Source indispensable : ${path}`);
  }
}
export function contextExcluded(choice: ContextChoice | null, path: string): boolean {
  return Boolean(choice?.exclude.some(excluded => path === excluded || path.startsWith(excluded + " — ")));
}
export const SOURCE_REASONS: Record<string, string> = {
  "current-manuscript": "Chapitre à travailler : texte conservé", "previous-manuscript": "Chapitre précédent : raccord et continuité",
  instructions: "Consignes de narration ou d’écriture", "planned-events": "Plan associé à ce chapitre",
  "adaptation-source-not-canon": "Texte Model associé au chapitre, sans valeur de fait acquis",
  "character-reference": "Référence détectée dans la demande, le passage ou sa configuration",
  "style-reference": "Référence de style configurée", "example-not-canon": "Exemple configuré, sans valeur de fait acquis",
  "verified-summary": "Résumé antérieur vérifié contre le texte conservé", "narrative-state": "État des références à cette position du récit",
  "approved-voice": "Extrait accepté pour la voix", "editorial-memory": "Consignes actives issues du suivi",
  "correction-examples": "Exemples des corrections de l’auteur", "correction-diff": "Différences entre version générée et corrections humaines",
  "author-feedback": "Retours de l’auteur", "author-request": "Demande actuelle", "task-instructions": "Méthode de travail indispensable",
  "structured-decisions-and-links-not-canon": "Identifiants, choix et liens narratifs", "narrative-position": "Position du chapitre dans le récit",
  "manual-reference": "Ajout explicite pour cette demande", "workshop-intentions-not-canon": "Fiche d’atelier pertinente, intention non acquise",
};
export function relatedWorkshop(data: StoryStructure, chapter: string): Set<string> {
  const target = data.nodes.find(node => node.path === chapter);
  const ids = new Set<string>();
  if (!target) return new Set();
  for (const scene of data.outline?.scenes ?? []) if (scene.chapter === target.id) ids.add(scene.id);
  for (const link of data.links) if (link.to === target.id && link.relation === "realise") ids.add(link.from);
  for (const relation of ["planifie", "implique", "developpe"]) for (const link of data.links) if (link.relation === relation && ids.has(link.to)) ids.add(link.from);
  return new Set(data.nodes.filter(node => ids.has(node.id) && !node.missing && node.decision !== "abandonne").map(node => node.path));
}

export function manualRole(path: string, folders: ProjectFolders): string {
  if (path.startsWith(folders.modelFolder + "/")) return "adaptation-source-not-canon";
  if (path.startsWith(`${folders.manuscriptFolder}/Chapitres/`)) return "current-manuscript";
  if (path.startsWith(`${folders.bibleFolder}/Style/`)) return "style-reference";
  if (path.startsWith(`${folders.bibleFolder}/Suivi/`) || path.endsWith("/suivi.md")) return "author-feedback";
  if (path.startsWith(folders.bibleFolder + "/")) return "character-reference";
  return "workshop-intentions-not-canon";
}
