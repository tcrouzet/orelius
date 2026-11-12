# Organisation et contexte

Les matériaux utiles sont recherchés automatiquement avant chaque demande : [fonctionnement de la recherche](Choisir-le-contexte.md). Le dernier rapport se trouve dans `Manuscript/Context/Recherche.md`.

[Accueil](Home.md)

Les noms ci-dessous sont les valeurs par défaut ; les réglages peuvent les remplacer.

`Chapters`, `Plan`, `Summaries`, `Characters` et `Context` sont des dossiers frères, directement dans le manuscrit. `Plan` et `Summaries` ne se trouvent jamais sous `Chapters`.

```text
Manuscript/
├── Chapters/       Texte conservé
├── Plan/           Intentions et déroulement prévus
├── Summaries/         Notes de résumé
├── Characters/    Notes liées au manuscrit
├── Seeds/          Idées initiales et choix
├── Synopsis/       Déroulement global
├── Scenes/         Objectifs, actions et conséquences
├── Arcs/           Évolution des personnages
├── Plots/      Fils narratifs, indices et résolutions
├── Variants/      Pistes alternatives
├── Checks/   Écarts et questions à résoudre
└── Context/        Sources, préparations et analyses du plugin

Model/             Sources organisées librement
```

Si vous avez choisi `Manuscrit` dans les réglages, cette même structure se trouve sous `Manuscrit/`. Les noms de sous-dossiers restent ceux affichés ci-dessus. `Summaries/` ne doit pas être confondu avec `Context/<chapitre>/etat.md`, où le plugin enregistre son analyse liée à une version précise du texte.

- `Manuscript/Chapters/` : texte conservé.
- `Model/` : organisation libre des sources de démarrage, textes, brouillons, plans et notes. Une source d’inspiration ne constitue pas un événement du roman.
- `Bible/Style/Narration.md` : voix et mode narratif ; les autres notes de Style apportent règles et exemples.
- `Bible/Characters/` : fiches des personnages.
- `Bible/Tracking/` : conversation, retours, connaissances et relevés horodatés.
- `Archives/` : versions conservées suivant la structure du projet ; agents archivés dans leur dossier dédié.
- `Manuscript/Context/configuration.md` : configuration éditable.
- `Manuscript/Context/002/` : `sources.md`, `prompts.md`, `preparation.md`, `etat.md`, `revue.md` et traces des méthodes. Les sous-dossiers des chapitres sont reproduits.
- `Manuscript/Context/suivi-etats.md` : états absents ou périmés.

## Configuration

La note contient exactement un bloc JSON. Les chemins sont relatifs au projet, avec les noms configurés. Exemple à adapter à vos fichiers existants :

```json
{
  "chapters": [
    {"path":"Manuscript/Chapters/001.md","previous":null},
    {"path":"Manuscript/Chapters/002.md","previous":"Manuscript/Chapters/001.md","pov":"Bible/Characters/Jonas.md","tense":"présent","references":["Bible/Characters/Jonas.md"]}
  ],
  "references": [
    {"path":"Bible/Characters/Jonas.md","name":"Jonas","aliases":["Jason"],"mode":"auto","priority":20},
    {"path":"Bible/Places/Ecole.md","name":"école","secondary":["Louise"],"secondaryMode":"all","priority":5}
  ],
  "recursiveReferences":true,
  "referenceBudget":30000,
  "maxCharacters":120000
}
```

Les listes peuvent rester vides. L’ordre des noms de fichiers sert alors de repli. `previous` définit le prédécesseur ; `null` coupe la chaîne. Une référence absente ou une configuration invalide produit une erreur explicite.

Les modes des références sont `auto` (détection du nom et des alias), `always`, `manual` (inclusion explicite) et `hidden`. `exclude` exclut certains déclencheurs ; `caseSensitive` contrôle la casse. `children` inclut des références associées. `hiddenSections` retire les sections désignées et leurs projections. Ces filtres concernent le contexte préparé, pas un secret inaccessible à tout outil de lecture.

`secondaryMode` vaut `all`, `any` ou `none` : la condition s’ajoute à la détection automatique. Une inclusion explicite la contourne. `priority` trie les références de la plus forte à la plus faible. `recursiveReferences` recherche aussi les mentions dans les références sélectionnées ; les cycles ne produisent pas de boucle infinie.

`referenceBudget` limite en caractères les références ajoutées au dossier. Les références optionnelles écartées sont listées dans les sources. Une référence obligatoire trop grande provoque une erreur. `maxCharacters` limite le dossier complet et provoque une erreur plutôt qu’une troncature silencieuse. Ce ne sont pas des budgets de tokens. Les règles déjà présentes dans les sources restent soumises au budget global.

`role` distingue `knowledge`, `style` et `example`. Le contexte conserve cette différence. `plan`, `model`, `act`, `include` et les références explicites des chapitres permettent d’organiser les sources. Vérifiez toujours `sources.md` pour voir ce qui a réellement été transmis.

## Conception du roman

Les nouveaux dossiers sont créés lors de la préparation du projet, depuis le menu Nouveau projet Orelius ou à l’ouverture d’un projet existant. [Peupler](Peupler.md) demande au modèle de les remplir depuis les sources disponibles. Les fiches sont modifiables directement ; [la file des modifications](Modifications.md) les signale à la demande suivante.

Commencez par [votre parcours de travail](Home.md) avant de modifier la configuration avancée ci-dessus.

## Dossiers documentaires externes

À la racine du projet, à côté d’`AGENTS.md`, `config.md` définit les sources accessibles en lecture seule. Modifiez son en-tête YAML :

```yaml
---
sources:
  - "/Users/votre-nom/Documents/Documentation"
  - "/Users/votre-nom/Documents/Autres textes"
---
```

Utilisez les chemins absolus de vos dossiers. La liste est transmise à Codex à chaque demande ; il parcourt ensuite les dossiers et lit les documents utiles avec `consulter_sources_documentaires`. Les changements de configuration prennent effet sans nouvelle session. Codex ne peut pas modifier cette configuration ni écrire dans ces sources. Les documents consultés sont aussi transmis au contrôle de publication.

Les formats texte Markdown, TXT, RST, CSV, JSON et YAML sont accessibles, par pages, jusqu’à 5 Mo par document. Les fichiers cachés et les liens symboliques dans les dossiers sont exclus. Les PDF et documents bureautiques doivent être convertis en texte pour cette première version. `Model` conserve son rôle de source de peuplement ; les dossiers externes servent à documenter les demandes sans importer tous leurs fichiers.
