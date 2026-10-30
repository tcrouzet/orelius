import { createHash } from "node:crypto";
import type { RpcObject } from "./codex.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { checkSceneContext, saveTaskPrompts, type SceneContext } from "./scene-context.ts";
import type { ProjectFolders } from "./settings.ts";

export class ChapterReview {
  private preparation: { context: SceneContext; document: string } | null = null;

  async prepare(cwd: string, folders: ProjectFolders, args: RpcObject, context: SceneContext,
    ensureCurrent: () => void = () => {}, configDir?: string): Promise<string> {
    this.preparation = null;
    const fields = ["situation", "objectif", "connaissances", "arrivee", "corrections", "incertitudes"];
    if (args.chemin !== context.chapter || fields.some(key => typeof args[key] !== "string" || !(args[key] as string).trim())
      || !Array.isArray(args.actions) || !args.actions.length || args.actions.some(action => typeof action !== "string" || !action.trim())
      || Object.keys(args).some(key => !["chemin", "actions", ...fields].includes(key))) {
      throw new Error("Préparez le chapitre ciblé : situation, objectif, actions concrètes ordonnées, connaissances du narrateur et du lecteur, arrivée, corrections et incertitudes. Ne fournissez pas encore de prose.");
    }
    if (!context.prompts) throw new Error("Les prompts de tâches du plugin ne sont pas chargés.");
    await checkSceneContext(cwd, context);
    const document = `# Préparation — ${context.chapter}\n\nPlan de travail avant rédaction, pas un événement acquis ni une validation de l’auteur.\n\nDossier : [sources](sources.md)\n\nEmpreinte du dossier : ${createHash("sha256").update(context.document).digest("hex")}\n\n## Situation initiale\n\n${String(args.situation)}\n\n## Objectif de la scène\n\n${String(args.objectif)}\n\n## Actions et réactions\n\n${args.actions.map((action, index) => `${index + 1}. ${String(action)}`).join("\n")}\n\n## Connaissances du narrateur, des personnages et du lecteur\n\n${String(args.connaissances)}\n\n## Point d’arrivée\n\n${String(args.arrivee)}\n\n## Corrections et référence de voix\n\n${String(args.corrections)}\n\n## Incertitudes et contradictions\n\n${String(args.incertitudes)}\n`;
    await writeProjectFile(cwd, context.preparationPath, document, await readProjectFile(cwd, context.preparationPath), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
    await saveTaskPrompts(cwd, folders, context, true, ensureCurrent, configDir);
    this.preparation = { context, document };
    return JSON.stringify({ fichier: context.preparationPath, consignes: [context.task, "controler-continuite", "actualiser-suivi"].map(name => ({ prompt: `prompts/${name}.md`, texte: context.prompts![name as keyof typeof context.prompts] })), resultat: "Préparation enregistrée. Vous pouvez rédiger en respectant cette situation, la voix de référence et les zones autorisées. Aucun texte du manuscrit n’a été changé. Une incertitude n’est pas un fait acquis ; ne la comblez pas par un antécédent inventé." });
  }

  async check(cwd: string, path: string): Promise<void> {
    if (!this.preparation || this.preparation.context.chapter !== path) {
      throw new Error("Consultez le dossier du chapitre puis utilisez preparer_chapitre pour établir situation et actions AVANT la prose. Aucun texte n’a été enregistré.");
    }
    await checkSceneContext(cwd, this.preparation.context);
    if ((await readProjectFile(cwd, this.preparation.context.preparationPath))?.text !== this.preparation.document) {
      throw new Error("La préparation a été modifiée. Relisez-la puis actualisez preparer_chapitre avant d’écrire.");
    }
  }
}
