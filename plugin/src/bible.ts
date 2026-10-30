import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { type ProjectFolders, validateProjectFolders } from "./settings.ts";

export const EDITORIAL_PRIORITIES = `Le sens, la continuité, les intentions de l’auteur et les exemples acceptés priment sur les objectifs de forme. Les indications chiffrées de style décrivent des tendances, jamais des quotas. Ne modifie pas les faits, les intentions, le temps narratif ou la structure d’une scène pour atteindre une fréquence ou une longueur de phrase. Respecte les formes à éviter en reformulant sans perdre le sens ; signale une contradiction irréductible.

Dans une adaptation ou une révision, respecte le texte source et les passages protégés selon la demande de l’auteur. Chaque geste, parole et réaction doit être compréhensible dans la scène : qui agit, sur qui ou quoi, et à quoi la réaction répond. Les pronoms, ellipses et sous-entendus doivent avoir un référent identifiable dans le texte. Une phrase courte, une image ou une marque d’oralité ne justifie pas une ambiguïté involontaire. Établis l’enjeu d’un dialogue avant de faire réagir les personnages ; n’ajoute pas un détail sans fonction pour donner une apparence de précision.`;

const NARRATION = `# Narration

Consignes de narration pour les textes romanesques du projet. Les choix non renseignés restent à définir avec l’auteur et ne valent pas consigne.

## Priorités d’écriture

${EDITORIAL_PRIORITIES}

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
