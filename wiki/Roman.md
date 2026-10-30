# Vue d’ensemble du roman

[Accueil](Home.md) · [Relier les scènes](Structure.md) · [Peupler](Peupler.md)

## Ouvrir le plan

Cliquez sur **Roman** dans le chat, ou lancez **Orelius : Vue d’ensemble du roman** depuis la palette de commandes. Le plan s’ouvre dans un onglet central, avec les actes, leurs chapitres et leurs scènes. Vous pouvez replier chaque acte ou chapitre. Cliquer sur un titre de note ouvre cette note dans un autre onglet.

Les chapitres proviennent de `Manuscript/Chapitres`, les scènes de `Manuscript/Scenes`. Une fiche correspond à une scène. Si ces fiches n’existent pas encore, demandez à **Peupler** de les préparer depuis vos textes. La vue ne découpe pas automatiquement les chapitres et ne fabrique pas leurs personnages ou intrigues.

Les noms de Manuscript et Bible suivent vos réglages. Les sous-dossiers sont pris en compte. Les titres affichés sont les noms des notes.

## Organiser les actes et les chapitres

Saisissez un titre dans **Nouvel acte**, puis cliquez sur **Ajouter l’acte**. Dans chaque chapitre, le sélecteur **Acte** permet de le rattacher à cet acte ou de le laisser sans acte. Le titre d’un acte peut être modifié sur place ; sa nouvelle valeur est enregistrée à la sortie du champ. Les chapitres sans acte restent visibles dans leur propre groupe.

Les actes suivent leur ordre de création. Les chapitres suivent l’ordre initial des notes ; cette version propose le déplacement des scènes et le rattachement des chapitres aux actes, sans réordonner les actes eux-mêmes.

## Déplacer une scène

Ouvrez **Organiser cette scène** :

- **Chapitre** affecte la scène à un chapitre, en fin de liste, ou la remet dans **Scènes non affectées**.
- **Monter** et **Descendre** changent son ordre dans le même chapitre.
- **Point de vue** indique le personnage ou narrateur choisi. Le champ reste vide tant que vous ne l’avez pas renseigné ; la nouvelle valeur est enregistrée en quittant le champ.
- **Statut** propose **À écrire**, **Brouillon**, **À réviser**, **Terminé**. Ce statut de travail ne vaut pas acceptation littéraire du texte.

Les choix sont enregistrés à la volée. Chaque changement archive le registre précédent. La scène conserve son identifiant, ses liens vers les personnages, les intrigues, les arcs et les fiches de plan.

## Ce que déplace le bouton

Le déplacement change l’emplacement prévu dans le plan. Il ne déplace ni le fichier de scène ni les paragraphes du manuscrit. Les liens vers les passages déjà écrits restent attachés à leurs citations d’origine. Si un passage lié se trouve dans un autre chapitre, la vue affiche **Raccord à vérifier**.

Exemple : vous déplacez une scène du chapitre 2 au chapitre 4. Elle apparaît désormais sous le chapitre 4. Son ancien passage reste repérable dans le chapitre 2. À votre prochaine demande, Codex reçoit cette organisation et peut préparer le transfert demandé, avec les contrôles et l’archivage habituels. Le simple déplacement ne lance aucune génération.

Lors de la première ouverture, une scène possédant un seul lien de réalisation est rangée dans le chapitre correspondant. Les scènes sans lien ou reliées à plusieurs chapitres restent non affectées. Ensuite, vos placements explicites sont conservés.

## Personnages et fils narratifs

Chaque scène affiche les personnages, intrigues et arcs déjà reliés dans le registre. Leurs titres sont cliquables. **Aucun lien renseigné** signifie que la relation n’a pas encore été enregistrée : demandez à Codex de relier les fiches concernées. Un lien dont les sources ont changé porte la mention **à revalider**.

La vue montre également les fiches de plan et les chapitres contenant des passages liés. Ces liens décrivent la structure connue, sans garantir que le texte respecte effectivement l’intention.

## Actualisation et sécurité

Utilisez **Actualiser** après avoir modifié des fiches dans d’autres onglets. Un renommage suivi par Obsidian conserve les identifiants et les placements. Une note absente reste signalée, afin de conserver ses dépendances. Une scène peut être réaffectée si son ancien chapitre a disparu.

Si le registre ou une source change depuis l’affichage, Orelius refuse l’action et demande d’actualiser. Attendez aussi la fin d’une tâche Codex avant de modifier le plan.

L’organisation est conservée dans le bloc JSON de `Manuscript/Context/Structure.md`, avec une présentation lisible au-dessus. Elle rejoint la file des modifications à transmettre et le contexte préparé pour Codex. Les relations d’emplacement sont distinctes des liens qui prouvent où se trouve un passage écrit.
