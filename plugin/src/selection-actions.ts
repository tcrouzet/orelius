import { t } from "./i18n.ts";
import { withoutContext } from "./request-context.ts";
import { fingerprint } from "./narrative-context.ts";
import type { RevisionPlan } from "./revision.ts";

export const SELECTION_ACTIONS = [
  { id: "developper", get label() { return t("expand"); }, method: "developper" },
  { id: "condenser", get label() { return t("condense"); }, method: "condenser" },
  { id: "reformuler", get label() { return t("rephrase"); }, method: "reformuler" },
  { id: "point-de-vue", get label() { return t("changePointOfView"); }, method: "reformuler" },
  { id: "variantes", get label() { return t("suggestAlternatives"); }, method: "idees" },
] as const;
export type SelectionAction = typeof SELECTION_ACTIONS[number]["id"];
export interface SelectionRequest { action: SelectionAction; path: string; from: number; to: number; hash: string; text: string; details: string; target: string }
const PREFIX = "Action Orelius sur sélection.\n";
const MARKER = "\n\n<!-- orelius:selection -->\n";
export function selectionRequest(action: SelectionAction, path: string, source: string, from: number, to: number, details = "", target = ""): SelectionRequest {
  if (!SELECTION_ACTIONS.some(item => item.id === action) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > source.length
    || !source.slice(from, to).trim() || [from, to].some(at => at > 0 && /[\uD800-\uDBFF]/.test(source[at - 1]) && /[\uDC00-\uDFFF]/.test(source[at] ?? ""))) throw new Error(t("selectANonEmptyContiguousPassage"));
  if (action === "point-de-vue" && !target.trim()) throw new Error(t("specifyTheDesiredCharacterOrPointOfView"));
  return { action, path, from, to, hash: fingerprint(source), text: source.slice(from, to), details: details.trim(), target: target.trim() };
}
export function selectionPlan(request: SelectionRequest, source: string): RevisionPlan {
  if (fingerprint(source) !== request.hash || source.slice(request.from, request.to) !== request.text) throw new Error(t("theChapterChangedSinceTheSelectionSelectThePassage"));
  selectionRequest(request.action, request.path, source, request.from, request.to, request.details, request.target);
  return { path: request.path, source, expected: source, ranges: [{ from: request.from, to: request.to }], wholeChapter: false, intentRecorded: true,
    selection: { from: request.from, to: request.to, readOnly: request.action === "variantes", method: SELECTION_ACTIONS.find(action => action.id === request.action)!.method } };
}
export function selectionSummary(request: SelectionRequest): string {
  const action = SELECTION_ACTIONS.find(item => item.id === request.action)!;
  return `${action.label} — ${request.path}${request.target ? `\nPoint de vue : ${request.target}` : ""}\n\n${request.text.split("\n").map(line => `> ${line}`).join("\n")}${request.details ? `\n\n${request.details}` : ""}`;
}
export function selectionPrompt(request: SelectionRequest): string {
  const method = SELECTION_ACTIONS.find(item => item.id === request.action)!;
  const instruction = t("readEveryPageOfConsulterContexteEditorialForThe", { value1: method.method, value2: request.from, value3: request.to, value4: request.target ? t("forActeurUseOnlyAnExactCharacterNameEstablished") : "", value5: request.action === "variantes"
    ? t("callProposerVariantesWithThreeWrittenAlternativesForThe")
    : t("thenPrepareTheChapterWithPreparerChapitreModifyOnly"), value6: request.action === "point-de-vue" ? t("useTheRequestedPointOfViewOnlyInThis") : "" });
  return PREFIX + selectionSummary(request) + MARKER + JSON.stringify({ ...request, instruction });
}
export function parseSelectionPrompt(text: string): SelectionRequest | null {
  text = withoutContext(text);
  if (!text.startsWith(PREFIX)) return null;
  const index = text.lastIndexOf(MARKER);
  if (index < 0) throw new Error(t("incompleteSelectionRequestSelectThePassageAgain"));
  let value: unknown;
  try { value = JSON.parse(text.slice(index + MARKER.length)); } catch { throw new Error(t("invalidSelectionRequest")); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("invalidSelectionRequest"));
  const request = value as SelectionRequest;
  if (!SELECTION_ACTIONS.some(item => item.id === request.action) || [request.path, request.text, request.hash, request.details, request.target].some(item => typeof item !== "string")
    || !/^[a-f0-9]{64}$/.test(request.hash) || !Number.isSafeInteger(request.from) || !Number.isSafeInteger(request.to) || request.from < 0 || request.to <= request.from
    || request.to - request.from !== request.text.length || !request.text.trim() || request.action === "point-de-vue" && !request.target.trim()) throw new Error(t("invalidSelectionRequest"));
  return request;
}
