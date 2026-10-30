# Orelius

Plugin Obsidian desktop pour écrire et réviser avec votre installation locale de Codex : chat latéral, contexte du roman, retours de lecture et versions archivées.

## Installation

Installez les fichiers `main.js`, `manifest.json` et `styles.css` de la release dans le dossier des plugins de votre coffre, puis activez **Orelius**. Dans les réglages, vérifiez Codex et choisissez votre dossier de travail. Les réglages sont enregistrés à la volée.

Ouvrez un chapitre et utilisez **Réviser** avec vos annotations ou une demande dans le chat. **Accepter** conserve le résultat comme exemple positif. Le texte et les données de contexte restent visibles dans le projet.

## Documentation

Le [wiki Orelius](https://github.com/tcrouzet/orelius/wiki) explique les réglages, les archives, le contexte, les méthodes, le suivi narratif et leurs limites. Le [guide de développement](https://github.com/tcrouzet/orelius/wiki/Developpement) couvre les contrôles, la publication et la liseuse EPUB.

## Développement

Node.js 24 ou ultérieur et Codex authentifié sont nécessaires aux contrôles locaux.

```sh
npm ci
npm run build
npm run check
```

Sources du plugin : [plugin/src](plugin/src/). Modèles éditoriaux : [prompts](prompts/). Livres d’exemple : [liseuse web](https://tcrouzet.github.io/orelius/).
