import { EDITORIAL_PRIORITIES } from "./bible.ts";
import { t } from "./i18n.ts";
import type { ProjectFolders } from "./settings.ts";

export const TASK_PROMPT_NAMES = ["verifier-prerequis", "approfondir-projet", "enrichir-bible", "preparer-scene", "rediger", "reviser", "controler-continuite", "controler-publication", "actualiser-suivi", "idees", "synopsis", "planifier", "decomposer-scene", "resumer", "developper", "reformuler", "condenser", "critiquer", "extraire-style", "adapter", "actualiser-bible", "decrire", "continuer"] as const;
export type TaskPromptName = typeof TASK_PROMPT_NAMES[number];
export type TaskPrompts = Record<TaskPromptName, string>;

export function renderTaskPrompts(templates: TaskPrompts, folders: ProjectFolders, chapter: string, contextPath: string, preparationPath: string, metadata: { pov?: string; tense?: string; date?: string } = {}): TaskPrompts {
  const variables: Record<string, string> = { editorialPriorities: EDITORIAL_PRIORITIES, chapter, contextPath, preparationPath, manuscriptFolder: folders.manuscriptFolder, bibleFolder: folders.bibleFolder, modelFolder: folders.modelFolder, pov: metadata.pov ?? "", tense: metadata.tense ?? "", storyDate: metadata.date ?? "" };
  const expand = (name: TaskPromptName, ancestors: string[] = []): string => {
    if (ancestors.includes(name)) throw new Error(t("promptInclusionCycle", { value1: name }));
    const template = templates[name];
    if (typeof template !== "string" || !template.trim()) throw new Error(t("missingTaskPrompt", { value1: name }));
    return template.replace(/\{include:([a-z-]+)\}/g, (_match, child: string) => {
      if (!(TASK_PROMPT_NAMES as readonly string[]).includes(child)) throw new Error(t("unknownComponent", { value1: child }));
      return expand(child as TaskPromptName, [...ancestors, name]);
    });
  };
  return Object.fromEntries(TASK_PROMPT_NAMES.map(name => {
    const template = renderConditions(expand(name), variables);
    const text = template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_match, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(variables, key)) throw new Error(t("unknownVariableIn", { value1: name, value2: key }));
      return variables[key];
    });
    return [name, text];
  })) as TaskPrompts;
}

export function renderConditions(template: string, variables: Record<string, string>): string {
  const stack: { parent: boolean; condition: boolean; alternative: boolean }[] = [];
  let visible = true;
  let cursor = 0;
  let output = "";
  for (const match of template.matchAll(/\{if:([a-zA-Z][a-zA-Z0-9]*)\}|\{else\}|\{\/if\}/g)) {
    if (visible) output += template.slice(cursor, match.index);
    if (match[1]) {
      if (!Object.prototype.hasOwnProperty.call(variables, match[1])) throw new Error(t("unknownCondition", { value1: match[1] }));
      const condition = Boolean(variables[match[1]].trim());
      stack.push({ parent: visible, condition, alternative: false });
      visible = visible && condition;
    } else {
      const frame = stack.at(-1);
      if (!frame) throw new Error(t("promptConditionNotOpened"));
      if (match[0] === "{else}") {
        if (frame.alternative) throw new Error(t("duplicatePromptAlternative"));
        frame.alternative = true;
        visible = frame.parent && !frame.condition;
      } else { stack.pop(); visible = frame.parent; }
    }
    cursor = match.index! + match[0].length;
  }
  if (stack.length) throw new Error(t("unclosedPromptCondition"));
  if (visible) output += template.slice(cursor);
  return output;
}
