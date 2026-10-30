# Architecture et limites

[Accueil](Home.md)

Le panneau Obsidian pilote Codex app-server. Un serveur MCP local expose les outils éditoriaux : contexte paginé, préparation, méthodes, écriture archivée, état narratif, revue par lots et consultation du suivi. Le modèle lit le contexte et prépare le chapitre avant de proposer son écriture. Le plugin vérifie les chemins, la version des sources et les contraintes de publication.

Le suivi automatique est une seconde étape bornée dans la même session, après une écriture. Il ne constitue pas une équipe de modèles autonomes. Les données persistantes restent en Markdown dans le projet, sans base vectorielle ni nouvelle dépendance.

## Garanties et limites

- Vérifiable par le code : empreintes, chemins, citations exactes, ordre des lots, archivage, refus d’écriture libre pendant le suivi, exclusion des tours internes du journal.
- Guidé par les prompts : pertinence de la préparation, interprétation des remarques, voix, humour, précision et cohérence des intentions.
- Non garanti : qualité littéraire, extraction exhaustive, bonne attribution d’un savoir, choix d’une action romanesque intéressante. Une citation valide peut accompagner une mauvaise interprétation.

Les retours et acceptations alimentent les prochaines consignes ; ils ne réentraînent pas le modèle. Les versions refusées ne doivent pas remplacer le texte conservé. La configuration explicite et les sources visibles permettent de diagnostiquer une dérive sans demander à l’auteur de lire les raisonnements intermédiaires.

## Ce qui reste à interpréter

L’analyse sémantique des contradictions et l’évaluation littéraire indépendante ne sont pas automatisées par un contrôleur séparé. Le modèle doit comprendre les sources et vos retours. Les archives, citations et états visibles permettent de vérifier sur quelles données il s’appuie et de corriger une mauvaise interprétation.

Protocole : [documentation officielle OpenAI App Server](https://learn.chatgpt.com/docs/app-server). Les sessions persistantes utilisent l’historique paginé. Les scénarios sans génération simulent les tours et leur historique ; les échanges MCP restent testés avec Codex local.

## Atelier et file de modifications

Le module workshop.ts lit les notes de projet, prépare l’inventaire paginé de Peupler et vérifie sa fraîcheur avant chaque écriture. La session limite les destinations de Peupler aux fiches d’atelier et aux notes Plan, Resume, Personnages. Les chapitres restent hors de cette autorisation.

Modifications.md conserve les empreintes des versions transmises et les changements en attente. Le message envoyé reçoit un complément technique, retiré de l’affichage de la conversation. Les changements ne sont acquittés qu’à la fin réussie de la tâche ; les versions générées sont enregistrées séparément. Une correction postérieure à la capture reste détectable.

## Structure narrative persistante

`story-structure.ts` conserve les identifiants des fiches et les décisions de l’auteur dans `Manuscript/Context/Structure.md`. `project-sources.ts` fournit le même inventaire aux changements, à l’atelier et à la structure. Les outils MCP `consulter_structure` et `relier_elements` exposent les liens typés et leurs empreintes ; ils ne peuvent pas retenir une fiche à la place de l’auteur. Les changements du registre passent par l’archivage et une file d’écriture par projet. Les liens enrichissent le contexte préparé et les conséquences des modifications. Voir [le parcours concret](Structure.md).

## Contrôle avant publication

`PublicationReview` intercepte les écritures de chapitres après validation de la préparation et de la portée autorisée. `codex-review.ts` ouvre un processus Codex séparé, une session éphémère en lecture seule, sans MCP d’écriture, avec le modèle actif. Le contrôleur reçoit les sources figées et rend un verdict JSON cité. Une première réponse défavorable retourne les corrections au rédacteur ; une seconde empêche les nouvelles reprises dans cette demande. Une évaluation invalide ne donne jamais l’autorisation d’écrire. Les candidats et rapports passent par l’archivage dans Context, sans rejoindre les sources narratives.

Le délai de l’outil MCP couvre le contrôle borné à trois minutes. Le bouton Arrêter et la déconnexion annulent aussi l’évaluation. Les [règles de protocole Codex](https://developers.openai.com/codex/app-server) et la [configuration MCP](https://developers.openai.com/codex/config-reference) servent de références pour cette intégration. Voir le [parcours d’écriture](Controle.md).
