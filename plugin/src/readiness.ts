import { dirname } from "node:path";
import { t } from "./i18n.ts";
import { fingerprint } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { checkSceneContext, type SceneContext } from "./scene-context.ts";
import type { ProjectFolders } from "./settings.ts";

export const READINESS_AXES = ["intention", "personnages-et-information", "voix", "documentation"] as const;
export interface ReadinessInput { contexte: SceneContext; preparation: string; catalogue?: string; correctionRapport?: { erreur: string; rapport: unknown }; deadline?: number }
export class ReadinessError extends Error {}
export interface ReadinessCheck {
  axe: typeof READINESS_AXES[number];
  statut: "suffisant" | "manquant" | "sans-objet";
  constat: string;
  appuis: { source: string; extrait: string }[];
  question: string;
  action: string;
}
export interface ReadinessVerdict { criteres: ReadinessCheck[] }
export type ReadinessEvaluator = (input: ReadinessInput, signal: AbortSignal) => Promise<unknown>;
export const readinessSchema = {
  type: "object", additionalProperties: false, required: ["criteres"], properties: {
    criteres: { type: "array", minItems: READINESS_AXES.length, maxItems: READINESS_AXES.length, items: {
      type: "object", additionalProperties: false, required: ["axe", "statut", "constat", "appuis", "question", "action"], properties: {
        axe: { type: "string", enum: READINESS_AXES }, statut: { type: "string", enum: ["suffisant", "manquant", "sans-objet"] },
        ...Object.fromEntries(["constat", "question", "action"].map(key => [key, { type: "string" }])),
        appuis: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "extrait"],
          properties: { source: { type: "string" }, extrait: { type: "string" } } } },
      },
    } },
  },
};

export function parseReadiness(value: unknown, input: ReadinessInput): ReadinessVerdict {
  const fail = (detail = ""): never => { throw new Error(`${t("readinessInvalid")}${detail ? ` ${detail}` : ""}`); };
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "criteres")) return fail();
  const checks = (value as ReadinessVerdict).criteres;
  if (!Array.isArray(checks) || checks.length !== READINESS_AXES.length) return fail();
  const axes = new Set<string>();
  for (const check of checks) {
    if (!check || !READINESS_AXES.includes(check.axe) || axes.has(check.axe) || !["suffisant", "manquant", "sans-objet"].includes(check.statut)
      || Object.keys(check).some(key => !["axe", "statut", "constat", "appuis", "question", "action"].includes(key))
      || typeof check.constat !== "string" || !check.constat.trim() || !Array.isArray(check.appuis)
      || typeof check.question !== "string" || typeof check.action !== "string"
      || check.statut === "manquant" && (!check.question.trim() || !check.action.trim())
      || check.statut !== "manquant" && !check.appuis.length) return fail();
    for (const support of check.appuis) {
      if (!support || Object.keys(support).some(key => !["source", "extrait"].includes(key)) || typeof support.source !== "string"
        || typeof support.extrait !== "string" || !support.extrait.trim()) return fail();
      const sources = input.contexte.sources.filter(source => source.path === support.source && source.role !== "task-instructions");
      if (!sources.length) return fail(t("reviewSourceUnavailable", { axis: check.axe, path: support.source }));
      if (!sources.some(source => source.content.includes(support.extrait))) return fail(t("reviewSourceQuoteMissing", { axis: check.axe, path: support.source }));
    }
    axes.add(check.axe);
  }
  return { criteres: checks };
}

export class ReadinessGate {
  private results = new Map<string, Promise<ReadinessVerdict>>();

  async check(cwd: string, folders: ProjectFolders, input: ReadinessInput, evaluate: ReadinessEvaluator, signal: AbortSignal,
    ensureCurrent: () => void = () => {}, configDir?: string): Promise<{ autorise: boolean; fichier: string; questions: ReadinessCheck[]; message: string }> {
    await checkSceneContext(cwd, input.contexte);
    ensureCurrent();
    // Rephrasing the writer's preparation cannot resolve missing author decisions.
    const key = fingerprint(JSON.stringify([input.contexte.document, input.contexte.sources, input.catalogue]));
    let result = this.results.get(key);
    if (!result) {
      result = this.evaluate(cwd, folders, input, evaluate, signal, ensureCurrent, configDir);
      this.results.set(key, result);
    }
    const verdict = await result;
    ensureCurrent();
    if (signal.aborted) throw new Error(t("publicationReviewInterrupted"));
    await checkSceneContext(cwd, input.contexte);
    const questions = verdict.criteres.filter(check => check.statut === "manquant");
    const message = questions.length ? `${t("readinessBlocked")}\n\n${questions.map(check => `${check.constat}\n${check.question}\n${check.action}`).join("\n\n")}` : t("readinessReady");
    const path = `${dirname(input.contexte.path)}/prerequis.md`;
    const content = `# Prérequis — ${input.contexte.chapter}\n\n${message}\n\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\`\n`;
    await writeProjectFile(cwd, path, content, await readProjectFile(cwd, path), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
    return { autorise: !questions.length, fichier: path, questions, message };
  }

  private async evaluate(cwd: string, folders: ProjectFolders, input: ReadinessInput, evaluate: ReadinessEvaluator,
    signal: AbortSignal, ensureCurrent: () => void, configDir?: string): Promise<ReadinessVerdict> {
    const request = { ...input, deadline: Date.now() + 180_000 };
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const raw = await evaluate(request, signal);
        ensureCurrent();
        if (signal.aborted) throw new Error(t("publicationReviewInterrupted"));
        await checkSceneContext(cwd, input.contexte);
        try { return parseReadiness(raw, input); }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const path = `${dirname(input.contexte.path)}/prerequis-invalide-${attempt}.md`;
          await writeProjectFile(cwd, path, `# Rapport technique invalide\n\n${message}\n\n\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\`\n`,
            await readProjectFile(cwd, path), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
          if (attempt === 2) throw error;
          request.correctionRapport = { erreur: message, rapport: raw };
        }
      }
    } catch (error) {
      throw new ReadinessError(t("readinessReviewFailed", { detail: error instanceof Error ? error.message : String(error) }));
    }
    throw new ReadinessError(t("readinessInvalid"));
  }
}
