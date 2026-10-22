# Orelius

Plugin Obsidian desktop pour discuter avec l’installation locale de Codex dans un panneau latéral. Ce socle comprend les réglages de connexion, le chat en Markdown, les réponses progressives, l’interruption et la reprise de la dernière conversation.

## Utilisation

Activez **Orelius** dans les modules complémentaires d’Obsidian. Ouvrez ensuite **Orelius : Ouvrir le chat** depuis la palette de commandes, ou cliquez sur l’icône de discussion du ruban.

Dans **Réglages → Orelius**, l’installation de Codex est détectée automatiquement. Si elle n’est pas trouvée, utilisez **Rechercher Codex** ; un champ de chemin manuel apparaît si cette recherche échoue. **Tester Codex**, juste sous l’installation, vérifie l’exécutable et son authentification indépendamment du dossier de travail. Codex utilise son authentification existante ; si nécessaire, lancez `codex login` dans le terminal.

Le bouton **Parcourir…** ouvre le sélecteur Obsidian pour choisir un dossier du coffre, y compris sa racine. Les modifications sont enregistrées automatiquement.

Dans **Organisation du projet**, les noms des dossiers sont personnalisables : **Archives**, **Manuscript** et **Bible** par défaut. Le dossier du manuscrit contient **Chapitres**, **Personnages**, **Plan** et **Resume**. Le dossier d’archives reprend cette structure sous `Archives/Manuscript/` et `Archives/Bible/`, avec les noms configurés. Les dossiers manquants sont créés au choix du dossier de travail, à la sortie d’un champ de nom ou à l’ouverture du chat. Un changement de nom utilise de nouveaux chemins ; les dossiers et fichiers existants, y compris les anciennes archives dans `_Archives`, sont conservés sur place. Ces noms s’appliquent aux différents dossiers de travail.

Dans l’explorateur de fichiers, cliquer sur le dossier de travail, un sous-dossier ou une note qu’il contient ouvre automatiquement le chat. La navigation entre notes par onglets ou liens suit le même comportement. Sortir des dossiers connus masque le panneau ; revenir dans le dossier le réaffiche avec ses messages à jour. Un dossier dont la conversation est déjà enregistrée retrouve sa propre session. Si plusieurs dossiers associés sont imbriqués, le plus précis est utilisé. Pendant une tâche, naviguer dans un autre dossier masque le chat et laisse Codex continuer dans son dossier initial ; une autre session ne peut être activée qu’une fois la tâche terminée ou arrêtée.

Écrivez un message, puis utilisez **Envoyer** ou **⌘/Ctrl + Entrée**. **Arrêter** interrompt la tâche ; pendant une connexion, il ferme cette connexion. **Nouvelle conversation** détache la conversation courante sans supprimer son historique Codex. Fermer ou masquer le panneau conserve la connexion et la tâche en arrière-plan. Désactiver le plugin arrête les processus lancés par Orelius.

Codex peut créer et modifier les fichiers du dossier de travail. Avant chaque patch sur un fichier existant, Orelius conserve son contenu original dans le dossier d’archives configuré, à la racine du projet. L’arborescence est reproduite et chaque copie reçoit une date et un identifiant distincts : avec les noms par défaut, `Manuscript/Chapitres/texte.md` devient par exemple `Archives/Manuscript/Chapitres/texte.<date>-<identifiant>.md`. Les fichiers de la bible sont conservés sous `Archives/Bible/`. Les versions précédentes sont conservées. Si l’archivage échoue ou si la note contient des modifications non enregistrées dans l’éditeur, le patch est refusé. Une création de fichier ne nécessite pas d’archive tant qu’aucun original n’existe.

Les écritures utilisent uniquement les patches approuvés après archivage. Les commandes restent dans un bac à sable en lecture seule ; les extensions de permissions sont refusées. Les outils externes (MCP, apps et plugins Codex) et la délégation sont désactivés dans le processus lancé par Orelius pour conserver ce passage obligatoire par l’archivage. La configuration globale de Codex n’est pas modifiée. Les suppressions, déplacements, liens symboliques et modifications du dossier d’archives configuré, de `_Archives`, `.obsidian` ou `.git` ne sont pas pris en charge. Les lectures utilisent les permissions de Codex : choisir un dossier de travail ne constitue pas une restriction de lecture à ce dossier. Une réponse textuelle dans le chat ne crée aucune note sans demande de modification.

Les réglages et l’identifiant de la conversation de chaque dossier sont enregistrés dans les données du plugin. Revenir dans un dossier retrouve sa conversation, y compris après un redémarrage d’Obsidian. L’historique reste géré par Codex et est rechargé à la reprise. **Nouvelle conversation** remplace uniquement l’association du dossier actif ; les anciens historiques restent dans Codex. Une conversation enregistrée avec l’ancien format est conservée pour son dossier. Les messages et les documents que Codex consulte peuvent être transmis au fournisseur configuré dans Codex. Orelius ne conserve aucune clé d’API.

## Agent du projet

Le générateur [generate-agent.ts](generate-agent.ts), à la racine de ce dépôt, crée `AGENTS.md` à la racine de chaque projet d’écriture lors de sa préparation. Le modèle [prompts/agent.md](prompts/agent.md) décrit les dossiers et le rôle de l’assistant d’écriture. Ses variables `{folder}`, `{manuscriptFolder}`, `{bibleFolder}` et `{archiveFolder}` reçoivent les valeurs des réglages du plugin ; toute variable inconnue est signalée.

Le générateur gère uniquement la section comprise entre `<!-- orelius:agent:start -->` et `<!-- orelius:agent:end -->`. Les consignes personnelles situées ailleurs sont conservées. Si le fichier existe sans ces marqueurs, la section est ajoutée à la suite. Chaque modification d’un `AGENTS.md` existant conserve d’abord son original dans le dossier d’archives configuré. Une génération identique ne modifie rien. Des marqueurs incomplets, un lien ou un échec d’archivage bloquent la mise à jour.

Le même modèle alimente le contexte envoyé à Codex lors de l’ouverture ou de la reprise d’une session, pour que les dossiers et le rôle restent cohérents avec les réglages actuels. Après modification du modèle, recompilez puis rechargez le plugin.

## Développement

Node.js 24 ou plus récent et Codex CLI `0.163.x` sont nécessaires. Le protocole a été vérifié avec `codex-cli 0.163.0` sur macOS. Une autre version mineure affiche une erreur de compatibilité.

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Le dossier `plugin/` contient les sources TypeScript, les styles, le manifeste et le fichier compilé du plugin. La compilation intègre le modèle Markdown dans `plugin/main.js`, puis copie `main.js`, `manifest.json` et `styles.css` à la racine du dépôt, qui sert ici de dossier d’installation Obsidian. Ces copies racine ne sont pas les sources à modifier. Pour une autre installation, copiez ces trois fichiers depuis `plugin/` dans `.obsidian/plugins/orelius/`. Le générateur et le modèle sont intégrés au fichier compilé ; aucun fichier de développement supplémentaire n’est nécessaire dans le coffre cible. Les réglages du coffre restent dans son `data.json`.

Le contrôle vérifie le générateur d’agent, les réglages, la structure des projets, les archives et Codex local authentifié : dossier effectif, refus d’une écriture et arrêt des processus. Il n’envoie aucun message au modèle.

Pour tester le panneau et les réglages dans une instance Obsidian isolée, utilisez `npm run check:obsidian`. Ce contrôle macOS crée un coffre temporaire, envoie un court message au modèle via Codex, puis vérifie l’affichage de la réponse et sa reprise après rechargement. Il ferme son instance de test et conserve une capture dans le dossier temporaire indiqué. Les essais ont été réalisés avec Obsidian 1.12.4.

Le code est réparti entre [l’intégration Obsidian](plugin/src/main.ts), [les données des réglages](plugin/src/settings.ts), [leur interface](plugin/src/settings-tab.ts), [le panneau de chat](plugin/src/chat-view.ts), [la connexion Codex](plugin/src/codex.ts), [la conversation](plugin/src/session.ts) et [l’archivage des originaux](plugin/src/archives.ts). Ce socle ne comprend pas encore les sélecteurs de zones et d’anciennes conversations ni les fonctions littéraires avancées décrites dans le cahier des charges.

## Références techniques

- [Codex Panel](https://github.com/murashit/codex-panel), licence Apache-2.0 : transport local `app-server` et séparation de la connexion et de l’interface.
- [Codex AI Agent](https://github.com/j4charlie/codex-ai-agent), licence MIT : événements de conversation et demandes d’autorisation.
- [Documentation officielle OpenAI — Codex App Server](https://developers.openai.com/codex/app-server) et schémas produits par l’exécutable local : initialisation, sessions, historique paginé, permissions et interruption.

Ces projets ont été examinés comme références ; aucun de leurs composants n’est requis à l’exécution.
