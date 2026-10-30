import type { ProjectFolders } from "./settings.ts";

export const TASK_PROMPT_NAMES = ["preparer-scene", "rediger", "reviser", "controler-continuite", "actualiser-suivi", "idees", "synopsis", "planifier", "decomposer-scene", "resumer", "developper", "reformuler", "condenser", "critiquer", "extraire-style", "adapter", "actualiser-bible", "decrire", "continuer"] as const;
export type TaskPromptName = typeof TASK_PROMPT_NAMES[number];
export type TaskPrompts = Record<TaskPromptName, string>;

export function renderTaskPrompts(templates: TaskPrompts, folders: ProjectFolders, chapter: string, contextPath: string, preparationPath: string): TaskPrompts {
  const variables: Record<string, string> = { chapter, contextPath, preparationPath, manuscriptFolder: folders.manuscriptFolder, bibleFolder: folders.bibleFolder, modelFolder: folders.modelFolder };
  const expand = (name: TaskPromptName, ancestors: string[] = []): string => {
    if (ancestors.includes(name)) throw new Error(`Cycle d’inclusion de prompt : ${name}.`);
    const template = templates[name];
    if (typeof template !== "string" || !template.trim()) throw new Error(`Prompt de tâche absent : ${name}.`);
    return template.replace(/\{include:([a-z-]+)\}/g, (_match, child: string) => {
      if (!(TASK_PROMPT_NAMES as readonly string[]).includes(child)) throw new Error(`Composant inconnu : ${child}.`);
      return expand(child as TaskPromptName, [...ancestors, name]);
    });
  };
  return Object.fromEntries(TASK_PROMPT_NAMES.map(name => {
    const template = expand(name);
    const text = template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_match, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(variables, key)) throw new Error(`Variable inconnue dans ${name} : ${key}.`);
      return variables[key];
    });
    return [name, text];
  })) as TaskPrompts;
}
