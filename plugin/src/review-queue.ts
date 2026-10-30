import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { fingerprint, readData } from "./narrative-context.ts";
import { reviewChunks } from "./writing-methods.ts";
import type { SceneContext } from "./scene-context.ts";
import type { ProjectFolders } from "./settings.ts";
import type { RpcObject } from "./codex.ts";

interface ReviewNote { quote: string; issue: string; suggestion: string }
interface ReviewQueue { hash: string; chapter: string; done: { index: number; notes: ReviewNote[] }[] }

export async function reviewBatch(cwd: string, folders: ProjectFolders, args: RpcObject, context: SceneContext,
  ensureCurrent: () => void, configDir?: string): Promise<string> {
  if (!["ouvrir", "suivant", "terminer"].includes(String(args.action)) || Object.keys(args).some(key => !["action", "lot", "empreinte", "remarques"].includes(key))) throw new Error("Action de revue invalide.");
  const manuscript = await readProjectFile(cwd, context.chapter);
  if (!manuscript) throw new Error("Chapitre absent.");
  const hash = fingerprint(manuscript.text);
  const path = context.path.replace(/sources\.md$/, "revue.md");
  const previous = await readProjectFile(cwd, path);
  const chunks = reviewChunks(manuscript.text);
  let queue: ReviewQueue = { hash, chapter: context.chapter, done: [] };
  if (previous) {
    const value = readData(previous.text) as ReviewQueue;
    if (value.hash === hash && value.chapter === context.chapter && Array.isArray(value.done)) queue = value;
    else if (args.action !== "ouvrir") throw new Error("Le chapitre a changé. Rouvrir la revue ; les anciens résultats seront archivés.");
  } else if (args.action !== "ouvrir") throw new Error("Ouvrez d’abord la revue.");
  if (queue.done.some((entry, index) => entry.index !== index || !Array.isArray(entry.notes)) || queue.done.length > chunks.length) throw new Error("Registre de revue incohérent ; fichier conservé.");
  if (args.action === "terminer") {
    if (args.empreinte !== hash || args.lot !== queue.done.length || !chunks[queue.done.length] || !Array.isArray(args.remarques)) throw new Error("Empreinte ou ordre de revue invalide.");
    const chunk = chunks[queue.done.length];
    const notes = args.remarques.map(value => {
      const note = value as ReviewNote;
      if (!note || typeof note.quote !== "string" || !note.quote.trim() || !chunk.text.includes(note.quote)
        || typeof note.issue !== "string" || !note.issue.trim() || typeof note.suggestion !== "string" || !note.suggestion.trim()
        || Object.keys(note).some(key => !["quote", "issue", "suggestion"].includes(key))) throw new Error("Chaque remarque exige une citation du lot, un problème et une suggestion.");
      return note;
    });
    queue.done.push({ index: queue.done.length, notes });
  }
  const content = `# Revue de ${context.chapter}\n\n${queue.done.length}/${chunks.length} lots examinés. Les remarques sont des propositions, sans modification du manuscrit ni validation de l’auteur.\n\n\`\`\`json\n${JSON.stringify(queue, null, 2)}\n\`\`\`\n`;
  if ((await readProjectFile(cwd, context.chapter))?.text !== manuscript.text) throw new Error("Chapitre modifié pendant la revue.");
  await writeProjectFile(cwd, path, content, previous, folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
  const next = chunks[queue.done.length];
  return JSON.stringify({ fichier: path, empreinte: hash, termines: queue.done.length, total: chunks.length,
    ...(next ? { lot: queue.done.length, texte: next.text, debut: next.start, fin: next.end,
      avant: manuscript.text.slice(0, next.start).split(/\s+/).slice(-200).join(" "), apres: manuscript.text.slice(next.end).split(/\s+/).slice(0, 200).join(" ") } : { termine: true, remarques: queue.done.flatMap(item => item.notes) }) });
}
