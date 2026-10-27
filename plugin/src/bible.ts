import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { type ProjectFolders, validateProjectFolders } from "./settings.ts";

const NARRATION = `# Narration

Consignes de narration pour les textes romanesques du projet. Les choix non renseignés restent à définir avec l’auteur et ne valent pas consigne.

## Mode narratif

- Personne grammaticale : à préciser.
- Narrateur (personnage, témoin, extérieur…) : à préciser.
- Point de vue et focalisation : à préciser.
- Temps du récit : à préciser.
- Changements de point de vue autorisés : à préciser.

## Style narratif

- Voix et ton : à préciser.
- Rythme et construction des phrases : à préciser.
- Registre et vocabulaire : à préciser.
- Place des descriptions, actions et dialogues : à préciser.
- Formes à privilégier ou à éviter : à préciser.

Les autres consignes et textes exemples de ce dossier complètent ces indications.
`;

export async function prepareBible(cwd: string, folders: ProjectFolders): Promise<void> {
  validateProjectFolders(folders);
  const path = `${folders.bibleFolder}/Style/Narration.md`;
  if (!await readProjectFile(cwd, path)) {
    const previous = await readProjectFile(cwd, `${folders.bibleFolder}/Narration.md`);
    await writeProjectFile(cwd, path, previous?.text ?? NARRATION, null, folders.archiveFolder);
  }
}
