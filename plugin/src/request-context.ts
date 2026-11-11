import { brainstormFolder } from "./brainstorm.ts";
import { t } from "./i18n.ts";
import { WORKSHOP_FOLDERS, type ProjectFolders } from "./settings.ts";
import type { StoryStructure } from "./story-structure.ts";

export interface ContextChoice { chapter: string | null; include: string[]; exclude: string[] }
const START = "\n\n<!-- orelius:request-context -->\n", END = "\n<!-- /orelius:request-context -->";
export function contextChoice(text: string): ContextChoice | null {
  const start = text.indexOf(START);
  if (start < 0) return null;
  const end = text.indexOf(END, start);
  if (end < 0 || text.indexOf(START, start + START.length) >= 0) throw new Error(t("contextChoicesAreIncompleteOrDuplicated"));
  const value: unknown = JSON.parse(text.slice(start + START.length, end));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("invalidContextChoices"));
  const choice = value as ContextChoice;
  const path = (value: unknown): value is string => typeof value === "string" && !value.includes("\\") && !value.includes("\0") && value.split("/").every(part => part && part !== "." && part !== "..") && /\.md$/i.test(value);
  if (Object.keys(choice).some(key => !["chapter", "include", "exclude"].includes(key)) || choice.chapter !== null && !path(choice.chapter)
    || !Array.isArray(choice.include) || !Array.isArray(choice.exclude) || [...choice.include, ...choice.exclude].some(value => !path(value))
    || new Set([...choice.include, ...choice.exclude]).size !== choice.include.length + choice.exclude.length) throw new Error(t("invalidContextChoices"));
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
  if (choice.chapter && chapter && choice.chapter !== chapter) throw new Error(t("theseContextChoicesBelongToAnotherChapterReopenContext"));
  const required = [chapter, `Tracking/Structure.md`, `Tracking/configuration.md`];
  for (const path of [...choice.include, ...choice.exclude]) {
    if (![folders.manuscriptFolder, folders.modelFolder, folders.bibleFolder, "Tracking"].some(folder => path.startsWith(folder + "/"))) throw new Error(t("noteOutsideTheWritingProject", { value1: path }));
    if (choice.exclude.includes(path) && required.includes(path)) throw new Error(t("requiredSource", { value1: path }));
  }
}
export function contextExcluded(choice: ContextChoice | null, path: string): boolean {
  return Boolean(choice?.exclude.some(excluded => path === excluded || path.startsWith(excluded + " — ")));
}
export const SOURCE_REASONS: Record<string, string> = {
  get "project-brief"() { return t("projectBriefSources"); },
  get "world-reference"() { return t("worldReferenceSources"); },
  get "current-manuscript"() { return t("targetChapterRetainedText"); }, get "previous-manuscript"() { return t("previousChapterConnectionAndContinuity"); },
  get instructions() { return t("narrationOrWritingInstructions"); }, get "planned-events"() { return t("planAssociatedWithThisChapter"); },
  get "adaptation-source-not-canon"() { return t("modelTextAssociatedWithTheChapterNotAnEstablished"); },
  get "character-reference"() { return t("referenceDetectedInTheRequestPassageOrConfiguration"); },
  get "style-reference"() { return t("configuredStyleReference"); }, get "example-not-canon"() { return t("configuredExampleNotAnEstablishedFact"); },
  get "verified-summary"() { return t("earlierSummaryCheckedAgainstTheRetainedText"); }, get "narrative-state"() { return t("referenceStateAtThisPointInTheStory"); },
  get "approved-voice"() { return t("acceptedVoiceExcerpt"); }, get "editorial-memory"() { return t("activeInstructionsFromTrackingNotes"); },
  get "correction-examples"() { return t("examplesOfTheAuthorSCorrections"); }, get "correction-diff"() { return t("differencesBetweenGeneratedTextAndHumanCorrections"); },
  get "author-feedback"() { return t("authorFeedback"); }, get "author-request"() { return t("currentRequest"); }, get "task-instructions"() { return t("requiredWorkingMethod"); },
  get "structured-decisions-and-links-not-canon"() { return t("narrativeIdentifiersChoicesAndLinks"); }, get "narrative-position"() { return t("chapterPositionInTheStory"); },
  get "manual-reference"() { return t("explicitAdditionForThisRequest"); }, get "workshop-intentions-not-canon"() { return t("relevantWorkshopNoteUnconfirmedIntention"); },
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
  if (brainstormFolder(path, folders)) return "workshop-intentions-not-canon";
  if (path.startsWith(folders.modelFolder + "/")) return "adaptation-source-not-canon";
  if (path.startsWith(`${folders.manuscriptFolder}/`)) return "current-manuscript";
  if (path.startsWith(`${folders.bibleFolder}/Style/`)) return "style-reference";
  if (path.startsWith(`Tracking/`) || path.endsWith("/suivi.md")) return "author-feedback";
  if (path.startsWith(`${folders.bibleFolder}/Characters/`)) return "character-reference";
  if ([...WORKSHOP_FOLDERS, "Plan", "Summaries", "Brainstorm"].some(folder => path.startsWith(`${folders.bibleFolder}/${folder}/`))) return "workshop-intentions-not-canon";
  if (path.startsWith(folders.bibleFolder + "/")) return "world-reference";
  return "workshop-intentions-not-canon";
}

const RESEARCH_MARKER = "\n\n<!-- orelius:material-search -->\n";
export function withoutMaterialSearch(text: string): string {
  const index = text.lastIndexOf(RESEARCH_MARKER);
  if (index < 0) return text;
  try {
    const value: unknown = JSON.parse(text.slice(index + RESEARCH_MARKER.length));
    if (value && typeof value === "object" && "matches" in value && Array.isArray(value.matches)) return text.slice(0, index);
  } catch { /* Preserve an ordinary message containing an incomplete marker. */ }
  return text;
}
export function withMaterialSearch(text: string, result: unknown): string {
  return withoutMaterialSearch(text) + RESEARCH_MARKER + JSON.stringify(result);
}
