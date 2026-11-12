# Développement et publication

[Accueil](Home.md)

## Développement

Obsidian 1.7.2 ou plus récent, Node.js 24 ou plus récent et Codex CLI avec App Server sont nécessaires. La compatibilité dépend des échanges utilisés, sans blocage sur un numéro de version mineure ou majeure : initialisation, authentification, configuration et catalogue des modèles sont vérifiés à la connexion. Les réponses utilisées pour les permissions et la reprise restent contrôlées ; une nouvelle version ne désactive aucune protection d’archivage. Une méthode absente est signalée avec la version détectée et son nom. **Tester Codex** affiche la version du serveur connecté. Après une mise à jour de Codex, la connexion suivante lance l’exécutable installé et peut reprendre la conversation enregistrée ; une tâche déjà lancée continue avec son processus existant.

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Le dossier `plugin/` contient les sources TypeScript, les styles, le manifeste et le fichier compilé du plugin. La compilation intègre le modèle Markdown dans `plugin/main.js`, puis copie `main.js`, `manifest.json` et `styles.css` à la racine du dépôt, qui sert ici de dossier d’installation Obsidian. Ces copies racine ne sont pas les sources à modifier. Pour une autre installation, copiez ces trois fichiers depuis `plugin/` dans `.obsidian/plugins/orelius/`. Le générateur et le modèle sont intégrés au fichier compilé ; aucun fichier de développement supplémentaire n’est nécessaire dans le coffre cible. Les réglages du coffre restent dans son `data.json`.

Le contrôle vérifie le générateur d’agent, les réglages, la structure des projets, les archives et Codex local authentifié : dossier effectif, refus d’une écriture directe, reprise avec l’outil MCP Orelius, appel de cet outil avec archivage et arrêt des processus. Il n’envoie aucun message au modèle.

`node scripts/check-session.mjs` vérifie l’envoi d’une consigne pendant une tâche réelle : ce contrôle appelle le modèle, écrit uniquement dans un projet temporaire et vérifie les fichiers, les archives humaines et générées ainsi que le journal. Il vérifie aussi la création de connaissances éditoriales et leur enrichissement après reprise, en conservant une note personnelle, puis supprime sa session de test.

Pour tester le panneau et les réglages dans une instance Obsidian isolée, utilisez `npm run check:obsidian`. Ce contrôle macOS crée un coffre temporaire, envoie un court message au modèle via Codex, puis vérifie l’affichage de la réponse et sa reprise après rechargement. Il ferme son instance de test et conserve une capture dans le dossier temporaire indiqué. Les essais ont été réalisés avec Obsidian 1.12.4.

Le code est réparti entre [l’intégration Obsidian](../plugin/src/main.ts), [les données des réglages](../plugin/src/settings.ts), [leur interface](../plugin/src/settings-tab.ts), [le panneau de chat](../plugin/src/chat-view.ts), [la connexion Codex](../plugin/src/codex.ts), [la conversation](../plugin/src/session.ts), [le serveur MCP local](../plugin/src/mcp.ts) et [l’archivage des originaux](../plugin/src/archives.ts).

## Publication

Le script [release.sh](../release.sh) publie une nouvelle version du plugin. Lancez `./release.sh` depuis la branche par défaut : il exécute les contrôles et la compilation, commite et pousse les modifications en cours, incrémente la version corrective, synchronise les deux manifestes et le paquet npm, puis crée et pousse le commit de version et son tag. La version de départ est celle de `manifest.json`. GitHub Actions compile depuis ce tag et publie `main.js`, `manifest.json` et `styles.css` comme pièces jointes de la release. Le workflow vérifie aussi la reproductibilité et la taille des fichiers, et produit les attestations de provenance.

Prérequis locaux : Node.js 24 ou ultérieur, npm, Git, jq, GitHub CLI authentifié et Codex authentifié pour `npm run check`. Les tests de publication utilisent Ruby pour lire le workflow YAML ; aucune requête au modèle n’est envoyée. GitHub Actions vérifie aussi le script avec ShellCheck.

La [soumission initiale à Obsidian](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) se fait après la création de la première release GitHub. Les versions suivantes utilisent le même script.

## Livres d’exemple sur le web

Le lecteur statique dans [scripts/web](../scripts/web/) utilise [epub.js](https://github.com/futurepress/epub.js). L’accueil présente uniquement les titres disponibles. Un clic ouvre le livre en pleine fenêtre, au format livre paginé par défaut. Les pages se tournent avec les flèches du clavier, par balayage tactile ou par un clic sur les bords du texte. Le seul bouton visible en lecture ouvre un menu hamburger : taille du texte, choix d’une police locale, format livre ou défilement continu, sommaire et retour à l’accueil. Le changement de format conserve la position de lecture. Les scripts embarqués dans les EPUB restent désactivés. Les versions d’epub.js et de JSZip chargées depuis le CDN sont figées et vérifiées par une empreinte d’intégrité.

Déposer les livres à publier dans [samples](../samples/), à la racine du dépôt. Les sous-dossiers et les noms avec espaces ou accents sont acceptés. Le catalogue présente le titre et l’auteur issus des métadonnées EPUB. Chaque livre possède son URL. Le menu permet aussi le téléchargement ; les préférences et la position de lecture sont conservées localement.

```sh
npm run check:web
npm run build:web
python3 -m http.server 8000 --directory _site
```

Ouvrir ensuite `http://localhost:8000`. La génération utilise seulement Node.js ; les contrôles utilisent aussi Ruby, comme les tests de publication du plugin. Le dossier `_site/` contient uniquement les fichiers du site, son catalogue et les EPUB de `samples/`. Il est généré et ignoré par Git.

Pour la première publication, sélectionner **Settings → Pages → Build and deployment → Source → GitHub Actions** dans le dépôt GitHub. Le [workflow Pages](../.github/workflows/pages.yml) publie ensuite les modifications du lecteur et de `samples/` poussées sur `main`. Il peut aussi être lancé manuellement depuis Actions. L’adresse prévue est [tcrouzet.github.io/orelius](https://tcrouzet.github.io/orelius/).

