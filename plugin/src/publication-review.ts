import { t } from "./i18n.ts";
import { dirname } from "node:path";
import { fingerprint } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { checkSceneContext, type SceneContext } from "./scene-context.ts";
import type { ProjectFolders } from "./settings.ts";

export const REVIEW_AXES = ["intention", "faits", "voix"] as const;
export interface PublicationCheck { axe: typeof REVIEW_AXES[number]; conforme: boolean; constat: string; passage: string; source: string; preuve: string; correction: string }
export interface FeedbackCheck { id: string; conforme: boolean; constat: string; passage: string; correction: string }
export interface PublicationVerdict { controles: PublicationCheck[]; retours: FeedbackCheck[] }
export function publicationFeedback(input: PublicationInput): { id: string; source: string; attente: string }[] {
  const feedback: { id: string; source: string; attente: string }[] = [];
  for (const source of input.contexte.sources) {
    const parts = source.role === "current-manuscript"
      ? [...source.content.matchAll(/\(\(\(([\s\S]*?)\)\)\)/g)].map(match => match[1]!)
      : (["author-request", "author-feedback"].includes(source.role) || source.role === "editorial-memory" && source.path.endsWith("/Tracking/Connaissances.md"))
        ? source.content.split(/\n\s*\n|\n(?=- )/) : [];
    for (const part of parts) {
      const attente = part.trim();
      if (!attente || /^#{1,6} [^\n]+$/.test(attente)) continue;
      feedback.push({ id: `retour-${feedback.length + 1}`, source: source.path, attente });
    }
  }
  return feedback;
}
export interface PublicationInput { candidat: string; preparation: string; contexte: SceneContext; precedent?: PublicationVerdict; correctionRapport?: { erreur: string; rapport: unknown } }
export type PublicationEvaluator = (input: PublicationInput, signal: AbortSignal) => Promise<unknown>;
export class PublicationError extends Error {
  readonly terminal: boolean;
  constructor(message: string, terminal: boolean) { super(message); this.terminal = terminal; }
}
export const publicationSchema = {
  type: "object", additionalProperties: false, required: ["controles", "retours"], properties: {
    retours: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "conforme", "constat", "passage", "correction"], properties: {
        id: { type: "string" }, conforme: { type: "boolean" },
        ...Object.fromEntries(["constat", "passage", "correction"].map(name => [name, { type: "string" }])) },
    } },
    controles: { type: "array", minItems: 3, maxItems: 3, items: {
      type: "object", additionalProperties: false,
      required: ["axe", "conforme", "constat", "passage", "source", "preuve", "correction"],
      properties: { axe: { type: "string", enum: REVIEW_AXES }, conforme: { type: "boolean" },
        ...Object.fromEntries(["constat", "passage", "source", "preuve", "correction"].map(name => [name, { type: "string" }])) },
    } },
  },
};
export function parsePublicationVerdict(value: unknown, input: PublicationInput): PublicationVerdict {
  const fail = (detail = t("reviewInvalidStructure")) => { throw new Error(`${t("publicationReviewIsInvalidOrLacksVerifiableEvidence")} ${detail}`); };
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["controles", "retours"].includes(key))) return fail();
  const checks = (value as PublicationVerdict).controles;
  if (!Array.isArray(checks) || checks.length !== REVIEW_AXES.length) return fail();
  const axes = new Set<string>();
  for (const check of checks) {
    if (!check || typeof check !== "object" || !REVIEW_AXES.includes(check.axe) || axes.has(check.axe) || typeof check.conforme !== "boolean"
      || Object.keys(check).some(key => !["axe", "conforme", "constat", "passage", "source", "preuve", "correction"].includes(key))
      || [check.constat, check.passage, check.source, check.preuve].some(value => typeof value !== "string" || !value.trim())
      || typeof check.correction !== "string" || !check.conforme && !check.correction.trim()) return fail();
    if (!input.candidat.includes(check.passage)) return fail(t("reviewCandidateQuoteMissing", { axis: check.axe }));
    let sources = [...input.contexte.sources, { path: input.contexte.preparationPath, role: "preparation", content: input.preparation }];
    if (check.axe === "faits") {
      sources = sources.filter(source => ["current-manuscript", "previous-manuscript", "character-reference", "world-reference", "external-documentation", "verified-summary", "narrative-state", "author-request"].includes(source.role));
      if (!sources.length) sources = [{ path: "candidat", role: "internal-consistency-only", content: input.candidat }];
    }
    if (check.axe === "voix") {
      const approved = sources.filter(source => source.role === "approved-voice");
      sources = approved.length ? approved : sources.filter(source => ["instructions", "style-reference", "task-instructions", "author-request"].includes(source.role));
    }
    const source = sources.find(source => source.path === check.source);
    if (!source) return fail(t("reviewSourceUnavailable", { axis: check.axe, path: check.source }));
    if (!sources.some(source => source.path === check.source && source.content.includes(check.preuve))) return fail(t("reviewSourceQuoteMissing", { axis: check.axe, path: check.source }));
    axes.add(check.axe);
  }
  const retours = (value as PublicationVerdict).retours;
  const expected = publicationFeedback(input);
  if (!Array.isArray(retours) || retours.length !== expected.length) return fail(t("reviewFeedbackIncomplete"));
  const ids = new Set<string>();
  for (const check of retours) {
    if (!check || typeof check !== "object" || !expected.some(item => item.id === check.id) || ids.has(check.id)
      || Object.keys(check).some(key => !["id", "conforme", "constat", "passage", "correction"].includes(key))
      || typeof check.conforme !== "boolean" || typeof check.constat !== "string" || !check.constat.trim()
      || typeof check.passage !== "string" || !check.passage.trim() || !input.candidat.includes(check.passage)
      || typeof check.correction !== "string" || !check.conforme && !check.correction.trim()) return fail(t("reviewFeedbackIncomplete"));
    ids.add(check.id);
  }
  return { controles: checks, retours };
}
interface Attempt { count: number; hashes: Set<string>; verdict?: PublicationVerdict; approved?: string; published: boolean; stopped: boolean }
export class PublicationReview {
  private attempts = new Map<string, Attempt>();
  private controller = new AbortController();
  cancel(): void { this.controller.abort(); }
  published(path: string): void { const attempt = this.attempts.get(path); if (attempt) attempt.published = true; }
  get incomplete(): boolean { return [...this.attempts.values()].some(attempt => !attempt.published); }

  async check(cwd: string, folders: ProjectFolders, input: PublicationInput, evaluate: PublicationEvaluator,
    ensureCurrent: () => void = () => {}, configDir?: string): Promise<void> {
    const context = input.contexte, path = context.chapter;
    const ensure = async () => {
      ensureCurrent();
      if (this.controller.signal.aborted) throw new Error(t("publicationReviewInterrupted"));
      await checkSceneContext(cwd, context);
      if ((await readProjectFile(cwd, context.preparationPath))?.text !== input.preparation) throw new Error(t("thePreparationChangedDuringReview"));
    };
    await ensure();
    const hash = fingerprint(input.candidat), key = fingerprint(hash + context.document + input.preparation);
    const attempt = this.attempts.get(path) ?? { count: 0, hashes: new Set<string>(), published: false, stopped: false };
    if (attempt.approved === key && !attempt.stopped) return;
    if (attempt.stopped || attempt.count >= 2) throw new PublicationError(t("prePublicationReviewEndedWithoutApprovalTheChapterWas"), true);
    if (attempt.hashes.has(key)) {
      attempt.stopped = true;
      throw new PublicationError(t("theRejectedCandidateWasSubmittedWithoutCorrectionsPublicationStopped"), true);
    }
    this.attempts.set(path, attempt);
    attempt.count++;
    attempt.hashes.add(key);
    attempt.published = false;
    const directory = `${dirname(context.path)}/Publication`;
    const save = async (name: string, content: string) => {
      await ensure();
      const destination = `${directory}/${name}.md`;
      await writeProjectFile(cwd, destination, content, await readProjectFile(cwd, destination), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
    };
    await save(`candidat-${attempt.count}`, input.candidat);
    let verdict: PublicationVerdict;
    try {
      const request: PublicationInput = { ...input, precedent: attempt.verdict };
      let raw = await evaluate(request, this.controller.signal);
      await ensure();
      try { verdict = parsePublicationVerdict(raw, request); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await save(`controle-${attempt.count}-invalide`, `# Rapport invalide\n\n${message}\n\n\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\`\n`);
        request.correctionRapport = { erreur: message, rapport: raw };
        raw = await evaluate(request, this.controller.signal);
        await ensure();
        try { verdict = parsePublicationVerdict(raw, request); }
        catch (error) {
          await save(`controle-${attempt.count}-invalide-2`, `# Rapport invalide\n\n\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\`\n`);
          throw error;
        }
      }
      await ensure();
    } catch (error) {
      attempt.stopped = true;
      let message = error instanceof Error ? error.message : String(error);
      if (!this.controller.signal.aborted) try { await save(`controle-${attempt.count}`, `# Contrôle interrompu\n\n${message}\n\nAucune autorisation de publication.\n`); }
      catch (traceError) { message += ` Trace non enregistrée : ${traceError instanceof Error ? traceError.message : String(traceError)}`; }
      throw new PublicationError(t("prePublicationReviewDidNotCompleteTheChapterWas", { value1: message }), true);
    }
    attempt.verdict = verdict;
    const issues = [...verdict.controles, ...verdict.retours].filter(check => !check.conforme);
    const report = `# Contrôle avant publication — ${path}\n\nCandidat : ${hash}\nDossier : ${fingerprint(context.document)}\nRésultat : ${issues.length ? "reprise nécessaire" : "contrôle favorable"}. Ce jugement du modèle ne vaut pas acceptation de l’auteur.\n\n\`\`\`json\n${JSON.stringify({ ...verdict, attentes: publicationFeedback(input) }, null, 2)}\n\`\`\`\n`;
    await save(`controle-${attempt.count}`, report);
    if (issues.length) {
      attempt.stopped = attempt.count === 2;
      throw new PublicationError(attempt.stopped
        ? `${t("secondReviewFailedPreserveTheChapterAndStopRevising")}\n${issues.map(check => `${"axe" in check ? check.axe : check.id}: ${check.constat} ${check.correction}`).join("\n")}`
        : `${t("candidateNotSavedMakeOneRevisionWithinTheAllowed")}\n${JSON.stringify(issues)}\nNe montrez pas les brouillons à l’auteur.`, attempt.stopped);
    }
    attempt.approved = key;
  }
}
