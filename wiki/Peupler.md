# Peupler le projet

[Accueil](Home.md) · [Choisir votre parcours](Home.md)

**Où ?** Bouton **Peupler** à côté du nom du dossier **Model** dans l’explorateur. Le nom configuré du dossier est pris en compte. L’action ouvre le chat du projet concerné.

**Quand ?** Pour organiser les documents déjà disponibles, au début du projet ou après l’ajout de nouveaux fichiers dans Model. Aucun chapitre actif n’est nécessaire.

Avant l’envoi, une fenêtre demande le cadrage du projet. Décrivez ce que vous voulez écrire et le rôle des sources : manuscrit à reprendre, documentation, référence ou exemple de style. **Parcourir** permet de choisir une note Markdown dans Model du projet, sous-dossiers compris ; son contenu accompagne votre description. Il faut une description ou une note non vide. Annuler ferme la fenêtre sans lancer Codex. Le cadrage transmis reste visible dans la conversation.

Un document de référence ne fournit pas automatiquement les personnages du projet. Précisez ce que Peupler doit en tirer et ce qu’il doit laisser de côté.

**Prompt ?** `prompts/peupler.md` dans le plugin. L’action y insère les noms de dossiers configurés avant de l’envoyer à Codex.

**Coût ?** Une tâche du modèle sélectionné dans le chat. Elle utilise votre accès Codex. Un projet volumineux demande davantage de lecture ; vous pouvez l’arrêter.

## Selon votre point de départ

- **Démarrer** : enregistrez une idée dans Model pour utiliser Peupler, même courte. Aucun manuscrit existant n’est nécessaire. Peupler organise cette matière et indique ce qui reste à décider.
- **Continuer** : copiez vos textes, plans et notes dans Model, librement organisés, et indiquez quelles versions sont retenues. Peupler installe les chapitres manquants sans reformulation et extrait leurs éléments dans Bible et Manuscript.
- **Adapter** : placez le texte source dans Model, sans structure imposée et vos intentions de transformation dans Manuscript/Seeds. Peupler prépare les fiches de la nouvelle version ; Manuscript/Chapters peut encore être vide.

## Ce que l’action remplit

Model peut rester vide lorsque vous partez de rien : commencez alors dans le chat. Peupler affiche une fenêtre si aucun nouveau document n’est disponible. Les sources lues sont des notes Markdown ; les documents Word, PDF et EPUB doivent être convertis avant utilisation.

Tous ces dossiers sont directement sous le dossier du manuscrit. Chacun doit recevoir un `index.md` qui présente les fiches disponibles ou les éléments encore inconnus.

| Dossier | Ce que vous y trouverez | Ce que vous pouvez y corriger |
| --- | --- | --- |
| Seeds | Idées initiales, conflits, pistes et leur statut | L’idée que vous retenez ou abandonnez |
| Synopsis | Déroulement global écrit et envisagé | Direction générale et conséquences recherchées |
| Scenes | Objectif, obstacle, décision et conséquence de chaque scène identifiable | L’action qui doit se produire et ce qu’elle change |
| Arcs | Motivations, choix et transformations des personnages | L’intention d’un personnage et son évolution |
| Plots | Fils narratifs, indices, révélations, promesses et résolutions | Ce qui doit rester ouvert ou être résolu |
| Variants | Alternatives présentes dans les sources ou demandées par l’auteur | Choix retenus et pistes rejetées |
| Checks | Contradictions, écarts entre intention et texte, questions | Votre réponse à une incohérence ou à un point indécidable |

La Bible (personnages, style, lieux et autres connaissances) ainsi que Plan, Summaries et Characters du manuscrit sont aussi complétés depuis les sources. Le modèle doit citer ses sources, distinguer prévu et écrit, conserver vos décisions et signaler les inconnues. Ces règles guident son interprétation ; le plugin ne peut pas garantir sa justesse.

## Protections

Peupler conserve Model intact. Il peut créer un chapitre seulement par copie exacte d’un texte source de Model ou d’un passage contigu ; il ne peut pas remplacer un chapitre existant. Il remplit les fiches de Bible et Manuscript, hors journaux et contexte interne. Les originaux et les nouvelles versions des fiches passent par l’archivage. Une modification des sources pendant la tâche impose à Codex de relire l’atelier avant de poursuivre l’écriture.

Les documents sont lus par pages. L’écriture est refusée tant que toutes les pages n’ont pas été consultées. En fin de tâche, un index absent ou vide produit un message « Atelier incomplet ». La présence des index ne garantit pas que toutes les scènes ou tous les problèmes ont été identifiés.

## Nouveaux documents et relances

Après une tâche réussie et complète, les chemins traités sont enregistrés dans `Manuscript/Context/Populate.md`. Les relances ne prennent que les nouveaux fichiers Markdown de Model. Les ajouts et corrections dans un fichier déjà traité sont ignorés par Peupler. Renommer un fichier lui donne un nouveau chemin : il sera considéré comme nouveau. Bible et Manuscript restent lus comme contexte pour préserver les décisions et éviter les doublons.

Un fichier ajouté pendant une tâche attend la prochaine relance. Une tâche interrompue, échouée ou incomplète laisse ses sources à traiter.

## Reprendre une tâche

Cliquez sur **Arrêter** pour interrompre. Les fiches déjà écrites restent enregistrées et archivées. Une nouvelle exécution lit ces fiches avec les sources actuelles et doit les compléter sans dupliquer les entrées ni effacer les décisions de l’auteur. Ne relancez pas Peupler pour chaque petite retouche : la file des modifications couvre ce besoin.

## Relier les résultats

Peupler peut créer des fiches distinctes et enregistrer leurs liens : graine vers plan, plan vers scènes, personnages et intrigues vers scènes, scènes vers passages du manuscrit. Ouvrez une fiche pour la retenir ou l’écarter avec **Cette fiche** dans le chat. Le [guide des liens et décisions](Structure.md) explique ce qui est vérifié et comment retrouver une idée dans le texte écrit.
