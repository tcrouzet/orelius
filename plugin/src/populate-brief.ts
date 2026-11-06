import { t } from "./i18n.ts";

export const POPULATE_BRIEF_MARKER = "\n\n[Orelius : description du projet pour Peupler]\n";
export function populateBrief(description: string, note?: { path: string; content: string }): string {
  if (!description.trim() && !note?.content.trim()) throw new Error(t("populateDescriptionRequired"));
  return [description.trim(), note ? `${t("populateDescriptionNote")}: ${note.path}\n\n${note.content}` : ""].filter(Boolean).join("\n\n");
}

export function isModelNote(path: string, modelPath: string): boolean {
  return path.startsWith(`${modelPath}/`) && /\.md$/i.test(path) && !path.split("/").some(part => part === ".." || part === ".");
}
