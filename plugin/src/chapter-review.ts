import { documentationSources, preparationSources, type PreparationSource } from "./preparation-sources.ts";
import { bibleReference, editorialObjectives, type EditorialObjective } from "./editorial-priorities.ts";
import { t } from "./i18n.ts";
import { createHash } from "node:crypto";
import type { RpcObject } from "./codex.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { checkSceneContext, saveTaskPrompts, type SceneContext } from "./scene-context.ts";
import type { ProjectFolders } from "./settings.ts";

export class ChapterReview {
  objectives: EditorialObjective[] = [];
  private documentation: PreparationSource[] = [];
  private preparation: { context: SceneContext; document: string } | null = null;

  async prepare(cwd: string, folders: ProjectFolders, args: RpcObject, context: SceneContext,
    ensureCurrent: () => void = () => {}, configDir?: string): Promise<string> {
    this.preparation = null;
    this.objectives = [];
    this.documentation = [];
    const fields = ["personnages", "situation", "objectif", "connaissances", "arrivee", "corrections", "incertitudes"];
    if (args.chemin !== context.chapter || fields.some(key => typeof args[key] !== "string" || !args[key].trim())
      || !Array.isArray(args.actions) || !args.actions.length || args.actions.some(action => typeof action !== "string" || !action.trim())
      || Object.keys(args).some(key => !["chemin", "actions", "objectifs", "documentation", ...fields].includes(key))) {
      throw new Error(t("prepareTheTargetChapterSituationGoalOrderedConcreteActions"));
    }
    this.documentation = preparationSources(args.documentation, context);
    if (!context.prompts) throw new Error(t("thePluginSTaskPromptsAreNotLoaded"));
    await checkSceneContext(cwd, context);
    if (args.objectifs === undefined && context.sources.some(source => bibleReference(source.path, folders) && editorialObjectives(source.path, source.content).some(goal => goal.level !== "suspendu"))) {
      throw new Error(t("priorityDeclareApplied"));
    }
    if (args.objectifs !== undefined) {
      if (!Array.isArray(args.objectifs)) throw new Error(t("priorityListExpected"));
      for (const value of args.objectifs as unknown[]) {
        if (!value || typeof value !== "object" || !("fiche" in value) || typeof value.fiche !== "string" || !("objectif" in value) || typeof value.objectif !== "string") throw new Error(t("priorityInvalidObjective"));
        const source = context.sources.find(source => source.path === value.fiche);
        const objective = source && bibleReference(source.path, folders) ? editorialObjectives(source.path, source.content).find(goal => goal.goal === value.objectif) : undefined;
        if (!objective || objective.level === "suspendu") throw new Error(t("priorityMissingObjective"));
        if (!this.objectives.some(goal => goal.path === objective.path && goal.goal === objective.goal)) this.objectives.push(objective);
      }
    }

    const document = `# Préparation — ${context.chapter}\n\nPlan de travail avant rédaction, pas un événement acquis ni une validation de l’auteur.\n\nDossier : [sources](sources.md)\n\nEmpreinte du dossier : ${createHash("sha256").update(context.document).digest("hex")}\n\n## Personnages : motivations et connaissances situées\n\n${String(args.personnages)}\n\n## Documentation externe\n\n${this.documentation.map(source => `### ${source.url}\n\nStatut : ${source.statut} — publication : ${source.publication}\n\n${source.raison}\n\n${source.extrait}`).join("\n\n") || "Aucune source externe nécessaire déclarée ; voir les incertitudes."}\n\n## Situation initiale\n\n${String(args.situation)}\n\n## Objectif de la scène\n\n${String(args.objectif)}\n\n## Actions et réactions\n\n${args.actions.map((action, index) => `${index + 1}. ${String(action)}`).join("\n")}\n\n## Connaissances du narrateur, des personnages et du lecteur\n\n${String(args.connaissances)}\n\n## Point d’arrivée\n\n${String(args.arrivee)}\n\n## Écriture : corrections et référence de voix\n\n${String(args.corrections)}\n\n## Incertitudes et contradictions\n\n${String(args.incertitudes)}\n\n## Objectifs appliqués\n\n${this.objectives.map(goal => `- [${goal.level}] ${goal.goal} — [[${goal.path}]]`).join("\n") || "Aucun objectif structuré déclaré."}\n`;
    await writeProjectFile(cwd, context.preparationPath, document, await readProjectFile(cwd, context.preparationPath), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
    await saveTaskPrompts(cwd, folders, context, true, ensureCurrent, configDir);
    this.preparation = { context, document };
    return JSON.stringify({ fichier: context.preparationPath, consignes: [context.task, "controler-continuite", "actualiser-suivi"].map(name => ({ prompt: `prompts/${name}.md`, texte: context.prompts![name as keyof typeof context.prompts] })), resultat: "Préparation enregistrée. Vous pouvez rédiger en respectant cette situation, la voix de référence et les zones autorisées. Aucun texte du manuscrit n’a été changé. Une incertitude n’est pas un fait acquis ; ne la comblez pas par un antécédent inventé." });
  }

  async publicationInput(cwd: string, path: string, candidat: string) {
    await this.check(cwd, path);
    return { candidat, preparation: this.preparation!.document, contexte: { ...this.preparation!.context, sources: [...this.preparation!.context.sources, ...documentationSources(this.documentation)] } };
  }

  async check(cwd: string, path: string): Promise<void> {
    if (!this.preparation || this.preparation.context.chapter !== path) {
      throw new Error(t("readTheChapterContextThenUsePreparerChapitreTo"));
    }
    await checkSceneContext(cwd, this.preparation.context);
    if ((await readProjectFile(cwd, this.preparation.context.preparationPath))?.text !== this.preparation.document) {
      throw new Error(t("thePreparationChangedReadItAgainAndUpdatePreparer"));
    }
  }
}
