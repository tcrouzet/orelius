import { dirname } from "node:path";
import { fingerprint } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { checkSceneContext, type SceneContext } from "./scene-context.ts";
import type { ProjectFolders } from "./settings.ts";

export const REVIEW_AXES = ["intention", "faits", "voix"] as const;
export interface PublicationCheck { axe: typeof REVIEW_AXES[number]; conforme: boolean; constat: string; passage: string; source: string; preuve: string; correction: string }
export interface PublicationVerdict { controles: PublicationCheck[] }
export interface PublicationInput { candidat: string; preparation: string; contexte: SceneContext; precedent?: PublicationVerdict }
export type PublicationEvaluator = (input: PublicationInput, signal: AbortSignal) => Promise<unknown>;
export class PublicationError extends Error {
  readonly terminal: boolean;
  constructor(message: string, terminal: boolean) { super(message); this.terminal = terminal; }
}
export const publicationSchema = {
  type: "object", additionalProperties: false, required: ["controles"], properties: {
    controles: { type: "array", minItems: 3, maxItems: 3, items: {
      type: "object", additionalProperties: false,
      required: ["axe", "conforme", "constat", "passage", "source", "preuve", "correction"],
      properties: { axe: { type: "string", enum: REVIEW_AXES }, conforme: { type: "boolean" },
        ...Object.fromEntries(["constat", "passage", "source", "preuve", "correction"].map(name => [name, { type: "string" }])) },
    } },
  },
};
export function parsePublicationVerdict(value: unknown, input: PublicationInput): PublicationVerdict {
  const fail = () => { throw new Error("Contrôle de publication invalide ou sans preuves vérifiables."); };
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "controles")) return fail();
  const checks = (value as PublicationVerdict).controles;
  if (!Array.isArray(checks) || checks.length !== REVIEW_AXES.length) return fail();
  const axes = new Set<string>();
  for (const check of checks) {
    if (!check || typeof check !== "object" || !REVIEW_AXES.includes(check.axe) || axes.has(check.axe) || typeof check.conforme !== "boolean"
      || Object.keys(check).some(key => !["axe", "conforme", "constat", "passage", "source", "preuve", "correction"].includes(key))
      || [check.constat, check.passage, check.source, check.preuve].some(value => typeof value !== "string" || !value.trim())
      || typeof check.correction !== "string" || !check.conforme && !check.correction.trim()
      || !input.candidat.includes(check.passage)) return fail();
    let sources = [...input.contexte.sources, { path: input.contexte.preparationPath, role: "preparation", content: input.preparation }];
    if (check.axe === "faits") {
      sources = sources.filter(source => ["current-manuscript", "previous-manuscript", "character-reference", "verified-summary", "narrative-state", "author-request"].includes(source.role));
      if (!sources.length) sources = [{ path: "candidat", role: "internal-consistency-only", content: input.candidat }];
    }
    if (check.axe === "voix") {
      const approved = sources.filter(source => source.role === "approved-voice");
      sources = approved.length ? approved : sources.filter(source => ["instructions", "style-reference", "task-instructions", "author-request"].includes(source.role));
    }
    if (!sources.some(source => source.path === check.source && source.content.includes(check.preuve))) return fail();
    axes.add(check.axe);
  }
  return { controles: checks };
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
      if (this.controller.signal.aborted) throw new Error("Contrôle de publication interrompu.");
      await checkSceneContext(cwd, context);
      if ((await readProjectFile(cwd, context.preparationPath))?.text !== input.preparation) throw new Error("La préparation a changé pendant le contrôle.");
    };
    await ensure();
    const hash = fingerprint(input.candidat), key = fingerprint(hash + context.document + input.preparation);
    const attempt = this.attempts.get(path) ?? { count: 0, hashes: new Set<string>(), published: false, stopped: false };
    if (attempt.approved === key && !attempt.stopped) return;
    if (attempt.stopped || attempt.count >= 2) throw new PublicationError("Contrôle avant publication terminé sans validation. Chapitre conservé ; aucune nouvelle reprise automatique. Relancez la demande pour repartir des sources actuelles.", true);
    if (attempt.hashes.has(key)) {
      attempt.stopped = true;
      throw new PublicationError("Le candidat refusé a été soumis sans correction. Publication arrêtée ; chapitre conservé.", true);
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
      const request = { ...input, precedent: attempt.verdict };
      verdict = parsePublicationVerdict(await evaluate(request, this.controller.signal), request);
      await ensure();
    } catch (error) {
      attempt.stopped = true;
      let message = error instanceof Error ? error.message : String(error);
      if (!this.controller.signal.aborted) try { await save(`controle-${attempt.count}`, `# Contrôle interrompu\n\n${message}\n\nAucune autorisation de publication.\n`); }
      catch (traceError) { message += ` Trace non enregistrée : ${traceError instanceof Error ? traceError.message : String(traceError)}`; }
      throw new PublicationError(`Contrôle avant publication non abouti : ${message} Le chapitre est conservé. Relancez la demande pour réessayer.`, true);
    }
    attempt.verdict = verdict;
    const issues = verdict.controles.filter(check => !check.conforme);
    const report = `# Contrôle avant publication — ${path}\n\nCandidat : ${hash}\nDossier : ${fingerprint(context.document)}\nRésultat : ${issues.length ? "reprise nécessaire" : "contrôle favorable"}. Ce jugement du modèle ne vaut pas acceptation de l’auteur.\n\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\`\n`;
    await save(`controle-${attempt.count}`, report);
    if (issues.length) {
      attempt.stopped = attempt.count === 2;
      throw new PublicationError(`${attempt.stopped ? "Seconde évaluation défavorable : chapitre conservé, arrêtez les reprises." : "Candidat non enregistré : effectuez UNE reprise dans la portée autorisée, puis soumettez le texte corrigé à ecrire_fichier."}\n${JSON.stringify(issues)}\nNe montrez pas les brouillons à l’auteur.`, attempt.stopped);
    }
    attempt.approved = key;
  }
}
