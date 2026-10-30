import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import { chapterPath } from "./corrections.ts";
import { readProjectFile } from "./project-files.ts";
import { recordFeedback } from "./feedback.ts";
import { acceptedChanges } from "./editorial-examples.ts";
import type { RevisionHighlight } from "./revision.ts";
import { validateProjectFolders, type ProjectFolders } from "./settings.ts";

export async function recordAcceptance(cwd: string, folders: ProjectFolders, path: string,
  snapshot: RevisionHighlight, message: string, checkEditor: (path: string, content: string) => void = () => {}): Promise<string> {
  validateProjectFolders(folders);
  if (chapterPath(cwd, folders, path) !== path) throw new Error("Ouvrez un chapitre du manuscrit pour accepter ses modifications.");
  if (snapshot.before === snapshot.after) throw new Error("Aucune modification à accepter.");
  const source = await readProjectFile(cwd, path);
  if (!source) throw new Error(`Chapitre introuvable : ${path}.`);
  checkEditor(path, source.text);
  const id = createHash("sha256").update(JSON.stringify([path, snapshot.before, snapshot.after, source.text, message])).digest("hex");
  const quote = (text: string) => text.split("\n").map(line => `    ${line}`).join("\n");
  const chapterLink = relative(`${folders.bibleFolder}/Suivi`, path).split(sep).map(encodeURIComponent).join("/");
  const reportPath = await recordFeedback(cwd, folders, {
    kind: "acceptance", id, title: `Version approuvée — ${JSON.stringify(path)}`,
    body: `Chapitre : [${JSON.stringify(path)}](<${chapterLink}>)\n\nL’auteur a cliqué sur « Accepter ». Cette version lui convient et sert d’exemple positif pour les prochains passages du projet, dans le respect de la narration et des consignes explicites. Cette approbation porte sur ce texte ; elle ne valide pas automatiquement chaque choix comme une règle générale.\n\n${source.text === snapshot.after ? "Le texte accepté correspond à la version produite par Codex." : "Le texte accepté comprend des retouches de l’auteur après la proposition Codex. Seule la version relue ci-dessous est approuvée ; ne pas attribuer ces retouches à Codex."}\n\n## Retour explicite de l’auteur\n\n${message.trim() ? quote(message) : "Aucun message supplémentaire."}\n\n## Version approuvée\n\n${quote(source.text)}${acceptedChanges(snapshot.before, source.text)}`,
    summary: "L’auteur accepte cette version comme exemple positif pour la suite du projet, avec une portée locale à ce chapitre et sans inventer de préférence.",
  }, (target, content) => {
    checkEditor(path, source.text);
    checkEditor(target, content);
  });
  if ((await readProjectFile(cwd, path))?.text !== source.text) throw new Error("Le chapitre a changé pendant l’acceptation. Le surlignage est conservé ; relisez cette version avant de l’accepter.");
  checkEditor(path, source.text);
  return reportPath;
}
