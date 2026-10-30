import { buildSceneContext } from "./scene-context.ts";
import { chapterPath, correctionReport } from "./corrections.ts";
import { readProjectFile } from "./project-files.ts";
import { validateProjectFolders, type ProjectFolders } from "./settings.ts";

type SourceRole = "instructions" | "current-manuscript" | "correction-examples" | "approved-example" | "author-feedback" | "working-draft" | "correction-diff" | "editorial-memory" | "index";

export async function readEditorialContext(cwd: string, folders: ProjectFolders, versions: Record<string, string>, chapter?: string): Promise<string[]> {
  validateProjectFolders(folders);
  if (chapter) return (await buildSceneContext(cwd, folders, versions, chapter)).pages;
  const sources: { path: string; content: string; role: SourceRole }[] = [];
  const add = async (path: string, role: SourceRole) => {
    const file = await readProjectFile(cwd, path);
    if (file) sources.push({ path, content: file.text, role });
  };
  await add(`${folders.bibleFolder}/Style/Narration.md`, "instructions");
  await add(`${folders.bibleFolder}/Style/rules.md`, "instructions");
  if (chapter && chapterPath(cwd, folders, chapter) === chapter) await add(chapter, "current-manuscript");
  await add(`${folders.bibleFolder}/Suivi/Exemples.md`, "correction-examples");
  const indexPath = `${folders.bibleFolder}/suivi.md`;
  const index = (await readProjectFile(cwd, indexPath))?.text ?? "";
  const reports = [...index.matchAll(/\]\(Suivi\/([^/\\\r\n()]+\.md)\)/g)].map(match => match[1]);
  const acceptedChapters = new Set<string>();
  const ratedResponses = new Set<string>();
  for (const name of [...new Set(reports)].reverse()) {
    if (!name.includes("-acceptation-") && !name.includes("-reaction-")) continue;
    const path = `${folders.bibleFolder}/Suivi/${name}`;
    const file = await readProjectFile(cwd, path);
    if (!file) continue;
    let role: SourceRole = "author-feedback";
    if (name.includes("-acceptation-")) {
      const chapter = /^Chapitre : \[("(?:[^"\\]|\\.)*")\]/m.exec(file.text)?.[1];
      if (chapter && /^## Version approuvée\r?$/m.test(file.text)) {
        const key = chapter.normalize("NFC").toLowerCase();
        if (acceptedChapters.has(key)) continue;
        acceptedChapters.add(key);
        role = "approved-example";
      }
    } else {
      const conversation = /^Conversation : ("(?:[^"\\]|\\.)*")\r?$/m.exec(file.text)?.[1];
      const response = /^Réponse : ("(?:[^"\\]|\\.)*")\r?$/m.exec(file.text)?.[1];
      if (conversation && response) {
        const key = JSON.stringify([conversation, response]);
        if (ratedResponses.has(key)) continue;
        ratedResponses.add(key);
      }
    }
    sources.push({ path, content: file.text, role });
  }
  for (const [path, baseline] of Object.entries(versions)) {
    if (chapterPath(cwd, folders, path) !== path) continue;
    const file = await readProjectFile(cwd, path);
    if (!file || (file.text === baseline && !file.text.includes("((("))) continue;
    if (path !== chapter) sources.push({ path, content: file.text, role: "working-draft" });
    sources.push({ path: `${path} — comparaison Codex/auteur`, content: correctionReport(path, baseline, file.text), role: "correction-diff" });
  }
  const memoryPath = `${folders.bibleFolder}/Suivi/Connaissances.md`;
  const memory = await readProjectFile(cwd, memoryPath);
  if (memory) {
    const active = /^## Consignes actives[^\n]*\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m.exec(memory.text)?.[0];
    sources.push({ path: memoryPath, content: active ?? memory.text, role: "editorial-memory" });
  }
  if (index) sources.push({ path: indexPath, content: index, role: "index" });
  // Small pages prevent large histories from being silently cut in tool output.
  const pages: typeof sources[] = [[]];
  let size = 0;
  for (const source of sources) {
    for (let offset = 0; offset < source.content.length; offset += 8000) {
      const content = source.content.slice(offset, offset + 8000);
      if (size && size + content.length > 8000) { pages.push([]); size = 0; }
      pages[pages.length - 1].push({ ...source, content });
      size += content.length;
    }
  }
  return pages.map((sources, page) => JSON.stringify({ page, pages: pages.length,
    ...(page === 0 ? { usage: "Le current-manuscript est le fichier présent sur disque, pas une preuve d’acceptation. Pour la continuité, partir des fichiers actuels du manuscrit et de la Bible : les variantes, archives et exemples stylistiques ne prouvent pas qu’un fait existe dans le récit conservé. La mémoire fournit seulement Consignes actives lorsque cette rubrique existe ; son historique complet reste consultable au chemin indiqué pour une recherche précise. Les correction-examples relient passages, commentaires exacts et sources avec leur statut. Dans les approved-example, seules la version approuvée et les sections Après sont acceptées ; les sections Avant restent des états antérieurs, sans approbation implicite. Respecter les réserves de l’auteur. Les working-draft sont des textes à examiner, pas des modèles de voix : leurs annotations peuvent rejeter le texte entier. Les correction-diff montrent les interventions humaines sans approuver les passages intacts. Les author-feedback portent sur un échange, pas sur tous les fichiers. La mémoire et l’index conservent aussi des avis historiques ; les derniers avis explicites sur le même objet priment. Relier la demande actuelle aux exemples acceptés et aux défauts signalés avant d’écrire. Consulter toutes les pages pour reconstituer chaque source intégrale." } : {}), sources }));
}
