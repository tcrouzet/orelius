import { contextExcluded } from "./request-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { checkSceneContext, type SceneContext } from "./scene-context.ts";
import { configPath, parseConfig, fingerprint, parseState, readData, statePath } from "./narrative-context.ts";
import { TASK_PROMPT_NAMES, type TaskPromptName } from "./task-prompts.ts";
import type { ProjectFolders } from "./settings.ts";
import type { RpcObject } from "./codex.ts";

export function reviewChunks(text: string, target = 2000): { start: number; end: number; text: string }[] {
  const chunks: ReturnType<typeof reviewChunks> = [];
  const blocks = [...text.matchAll(/[^\n](?:[\s\S]*?)(?=\n\s*\n|$(?![\s\S]))/g)];
  for (const block of blocks) {
    const start = block.index!;
    const end = start + block[0].length;
    const last = chunks.at(-1);
    if (last && end - last.start <= target) { last.end = end; last.text = text.slice(last.start, end); }
    else chunks.push({ start, end, text: text.slice(start, end) });
  }
  return chunks;
}
export async function consultMethod(cwd: string, folders: ProjectFolders, args: RpcObject, context: SceneContext,
  ensureCurrent: () => void, configDir?: string): Promise<string> {
  if (typeof args.tache !== "string" || !(TASK_PROMPT_NAMES as readonly string[]).includes(args.tache)
    || Object.keys(args).some(key => !["tache", "consigne", "debut", "fin", "lot", "acteur"].includes(key))
    || args.consigne !== undefined && typeof args.consigne !== "string" || args.acteur !== undefined && typeof args.acteur !== "string") throw new Error("Tâche ou paramètres de méthode invalides.");
  await checkSceneContext(cwd, context);
  const task = args.tache as TaskPromptName;
  const prompt = context.prompts?.[task];
  if (!prompt) throw new Error("Prompt absent du plugin.");
  const source = (await readProjectFile(cwd, context.chapter))?.text ?? "";
  let start = args.debut ?? 0;
  let end = args.fin ?? source.length;
  const chunks = reviewChunks(source);
  if (args.lot !== undefined) {
    if (args.debut !== undefined || args.fin !== undefined || !Number.isSafeInteger(args.lot) || Number(args.lot) < 0 || !chunks[Number(args.lot)]) throw new Error("Lot de revue invalide.");
    ({ start, end } = chunks[Number(args.lot)]);
  }
  if (typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.length) throw new Error("Sélection hors du texte conservé.");
  const before = source.slice(0, start).match(/\S+\s*/g)?.slice(-200).join("") ?? "";
  const after = source.slice(end).match(/\S+\s*/g)?.slice(0, 200).join("") ?? "";
  let acquired: unknown[] = [];
  const state = await readProjectFile(cwd, statePath(folders, context.chapter));
  const configNote = await readProjectFile(cwd, configPath(folders));
  const references = configNote ? parseConfig(readData(configNote.text), folders).references : [];
  if (state && !contextExcluded(context.choice ?? null, statePath(folders, context.chapter))) {
    try {
      const parsed = parseState(readData(state.text), context.chapter, source);
      acquired = (Object.keys(parsed.dependencies ?? {}).some(path => contextExcluded(context.choice ?? null, path)) ? [] : parsed.facts)
        .filter(fact => !contextExcluded(context.choice ?? null, fact.entity))
        .filter(fact => !references.some(reference => reference.path === fact.entity && (reference.mode === "hidden" || reference.hiddenSections?.includes(fact.field))))
        .filter(fact => (fact.at ?? source.length) <= start && (args.acteur === undefined || fact.knownBy.includes(String(args.acteur))));
    } catch { /* A stale state cannot establish knowledge at the selection. */ }
  }
  const payload = { connaissancesAvantSelection: acquired, tache: task, chapitre: context.chapter, empreinte: fingerprint(source), consigne: args.consigne ?? "", prompt,
    selection: { debut: start, fin: end, texte: source.slice(start, end), avant: before, apres: after },
    lots: chunks.map((chunk, index) => ({ lot: index, debut: chunk.start, fin: chunk.end })),
    unite: "Positions UTF-16 ; voisinage de 200 mots ; lots ciblant 2000 caractères sans couper un paragraphe. Ce ne sont pas des tokens.",
    protection: "Cette consultation n’élargit aucune autorisation de modification. Préparation et protections Orelius restent obligatoires." };
  const path = context.path.replace(/sources\.md$/, `methode-${task}.md`);
  await writeProjectFile(cwd, path, `# Méthode — ${task}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`, await readProjectFile(cwd, path), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
  return JSON.stringify(payload);
}
export async function recordNarrativeState(cwd: string, folders: ProjectFolders, args: RpcObject,
  chapter: string, ensureCurrent: () => void, configDir?: string, context?: SceneContext): Promise<string> {
  const manuscript = await readProjectFile(cwd, chapter);
  if (!manuscript) throw new Error("Le chapitre doit être enregistré avant son extraction.");
  if (args.dependencies !== undefined) throw new Error("Les dépendances sont calculées par le plugin.");
  const state = parseState(args, chapter, manuscript.text);
  state.dependencies = {};
  for (const [path, original] of context?.snapshots ?? []) {
    if (path === chapter || !path.startsWith(`${folders.manuscriptFolder}/Chapitres/`) || original === null) continue;
    if ((await readProjectFile(cwd, path))?.text !== original) throw new Error(`Source narrative modifiée : ${path}`);
    state.dependencies[path] = fingerprint(original);
  }
  const path = statePath(folders, chapter);
  const document = `# État narratif — ${chapter}\n\nAnalyse liée au texte conservé, pas une validation de l’auteur. Les citations sont vérifiées ; leur interprétation peut rester erronée. knownBy nomme les détenteurs de chaque information, notamment lecteur ou narrateur si le texte l’établit.\n\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`;
  const check = () => ensureCurrent();
  if ((await readProjectFile(cwd, chapter))?.text !== manuscript.text) throw new Error("Chapitre modifié pendant l’extraction.");
  await writeProjectFile(cwd, path, document, await readProjectFile(cwd, path), folders.archiveFolder, undefined, check, false, undefined, configDir);
  return JSON.stringify({ fichier: path, empreinte: state.hash, resultat: "État enregistré ; il sera exclu si le chapitre change." });
}
