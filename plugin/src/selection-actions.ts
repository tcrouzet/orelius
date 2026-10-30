import { withoutContext } from "./request-context.ts";
import { fingerprint } from "./narrative-context.ts";
import type { RevisionPlan } from "./revision.ts";

export const SELECTION_ACTIONS = [
  { id: "developper", label: "Développer", method: "developper" },
  { id: "condenser", label: "Condenser", method: "condenser" },
  { id: "reformuler", label: "Reformuler", method: "reformuler" },
  { id: "point-de-vue", label: "Changer de point de vue", method: "reformuler" },
  { id: "variantes", label: "Proposer des variantes", method: "idees" },
] as const;
export type SelectionAction = typeof SELECTION_ACTIONS[number]["id"];
export interface SelectionRequest { action: SelectionAction; path: string; from: number; to: number; hash: string; text: string; details: string; target: string }
const PREFIX = "Action Orelius sur sélection.\n";
const MARKER = "\n\n<!-- orelius:selection -->\n";
export function selectionRequest(action: SelectionAction, path: string, source: string, from: number, to: number, details = "", target = ""): SelectionRequest {
  if (!SELECTION_ACTIONS.some(item => item.id === action) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > source.length
    || !source.slice(from, to).trim() || [from, to].some(at => at > 0 && /[\uD800-\uDBFF]/.test(source[at - 1]) && /[\uDC00-\uDFFF]/.test(source[at] ?? ""))) throw new Error("Sélectionnez un passage non vide, d’un seul tenant.");
  if (action === "point-de-vue" && !target.trim()) throw new Error("Indiquez le personnage ou le point de vue souhaité.");
  return { action, path, from, to, hash: fingerprint(source), text: source.slice(from, to), details: details.trim(), target: target.trim() };
}
export function selectionPlan(request: SelectionRequest, source: string): RevisionPlan {
  if (fingerprint(source) !== request.hash || source.slice(request.from, request.to) !== request.text) throw new Error("Le chapitre a changé depuis la sélection. Sélectionnez de nouveau le passage.");
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
  const instruction = `Lis toutes les pages de consulter_contexte_editorial pour le chapitre indiqué, puis appelle consulter_methode avec tache=${method.method}, debut=${request.from}, fin=${request.to}, consigne=la demande actuelle et le point de vue demandé${request.target ? ". Pour acteur, utilise seulement un nom de personnage exact établi dans les sources, pas une formule comme première personne" : ""}. Les positions sont UTF-16 dans le texte conservé, pas dans une ancienne version. Lis le contexte voisin pour les raccords. ${request.action === "variantes"
    ? "Appelle proposer_variantes avec trois variantes rédigées de la sélection (titre distinct et texte du passage seulement). Cet outil conserve les propositions sans modifier le chapitre. Dans ta réponse finale, résume leurs différences et indique que Comparer les versions permet de les choisir. Ne modifie aucun autre fichier : ces propositions ne sont pas du texte accepté."
    : "Prépare ensuite le chapitre avec preparer_chapitre. Modifie uniquement la sélection exacte ; tous les caractères avant et après, espaces et retours inclus, doivent rester identiques. Enregistre le chapitre complet avec ecrire_fichier ; contrôle avant publication et archivage restent obligatoires. Une précision dans le chat ne libère pas le reste du chapitre."} ${request.action === "point-de-vue" ? "Adopte le point de vue demandé seulement dans ce passage ; respecte les faits, adapte les perceptions et limite les informations à ce que ce personnage peut savoir. Ne change pas la narration générale dans la Bible." : ""}`;
  return PREFIX + selectionSummary(request) + MARKER + JSON.stringify({ ...request, instruction });
}
export function parseSelectionPrompt(text: string): SelectionRequest | null {
  text = withoutContext(text);
  if (!text.startsWith(PREFIX)) return null;
  const index = text.lastIndexOf(MARKER);
  if (index < 0) throw new Error("Demande de sélection incomplète. Sélectionnez de nouveau le passage.");
  let value: unknown;
  try { value = JSON.parse(text.slice(index + MARKER.length)); } catch { throw new Error("Demande de sélection invalide."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Demande de sélection invalide.");
  const request = value as SelectionRequest;
  if (!SELECTION_ACTIONS.some(item => item.id === request.action) || [request.path, request.text, request.hash, request.details, request.target].some(item => typeof item !== "string")
    || !/^[a-f0-9]{64}$/.test(request.hash) || !Number.isSafeInteger(request.from) || !Number.isSafeInteger(request.to) || request.from < 0 || request.to <= request.from
    || request.to - request.from !== request.text.length || !request.text.trim() || request.action === "point-de-vue" && !request.target.trim()) throw new Error("Demande de sélection invalide.");
  return request;
}
