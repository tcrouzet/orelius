Orelius — Cahier des charges initial
1. Objectif
Créer un plugin Obsidian sur mesure nommé Orelius, développé en TypeScript. Il permettra de travailler avec Codex sur un manuscrit depuis un panneau latéral, tout en écrivant normalement dans Obsidian.
La première version doit permettre de désigner plusieurs dossiers du vault comme zones manuscrites, d’en activer une, puis d’y démarrer ou reprendre une session Codex.
Le plugin sera développé par une instance Codex lancée dans le terminal, dans le dossier de développement d’Orelius. Les sessions d’écriture ouvertes par Orelius seront distinctes de cette session de développement.
2. Zones manuscrites
Une zone manuscrite est un dossier du vault et son contenu. Elle peut contenir un roman, des notes, des plans, des personnages et tout autre document utile.
- Permettre de choisir un dossier existant et de l’enregistrer comme zone manuscrite, avec un nom affiché.
- Permettre d’enregistrer plusieurs zones et de choisir la zone active depuis le panneau latéral.
- Une seule zone est active dans le panneau à un instant donné. Ouvrir une note d’un autre dossier ne change pas automatiquement cette zone.
- Afficher clairement le nom et le chemin de la zone active.
- Enregistrer les zones avec un identifiant stable et un chemin relatif au vault dans les données du plugin. Aucun projet.yml n’est requis.
- Retirer une zone de la liste ne supprime aucun fichier du manuscrit.
- Si le dossier devient introuvable, proposer de le relocaliser en conservant son identité et ses associations de sessions.
L’arborescence interne reste libre et évolutive. Ne pas imposer de dossiers « Chapitres », « Personnages » ou autres, ni créer un squelette de roman à cette étape. Orelius doit fonctionner dans un dossier vide comme dans un dossier déjà organisé.
3. Sessions Codex
- Démarrer une nouvelle session avec le dossier de la zone active comme répertoire de travail.
- Associer chaque session à l’identifiant de sa zone manuscrite.
- Conserver cette association et permettre de reprendre la session après fermeture du panneau ou redémarrage d’Obsidian.
- Permettre une nouvelle conversation et la reprise d’une conversation précédente de cette zone.
- Un changement de zone affiche ses propres conversations. Ne jamais poursuivre la conversation du manuscrit A dans le manuscrit B.
- Pour cette première version, une seule tâche Codex s’exécute à la fois dans Orelius. Pendant une tâche, attendre sa fin ou utiliser « Arrêter » avant de changer de zone ou de session.
- Après relocalisation d’une zone, reprendre sa session avec le nouveau répertoire de travail et informer Codex du changement de chemin.
Codex doit pouvoir lire, créer et modifier les fichiers de la zone à la demande de l’auteur. Un fichier AGENTS.md peut être présent à sa racine : conserver le mécanisme normal de lecture des instructions de Codex, sans inventer de consignes littéraires dans le code du plugin.
Configurer les permissions de travail pour limiter les écritures ordinaires à la zone concernée. Un répertoire de travail ne constitue pas à lui seul une restriction d’accès : vérifier les possibilités réelles du protocole Codex. Ne pas élargir silencieusement les permissions au vault entier ou au dossier du plugin.
4. Panneau latéral
Une commande Obsidian ouvre le panneau Orelius. L’interface suit le thème d’Obsidian et reste sobre, en français.
Élément	Fonction
Sélecteur de zone	Choisir le manuscrit actif et enregistrer un dossier
Sélecteur de conversation	Reprendre une session de cette zone ou en créer une
Conversation	Afficher les messages de l’auteur et les réponses de Codex en Markdown
Champ de saisie	Écrire un message multiligne et l’envoyer
Bouton Arrêter	Interrompre la tâche en cours
État de session	Indiquer connexion, activité, attente d’une réponse ou erreur


Afficher les réponses progressivement et rendre visibles les opérations utiles : lecture ou modification d’un fichier, tâche en cours, demande d’autorisation. Les demandes nécessaires au fonctionnement de Codex doivent pouvoir être traitées dans le panneau.
Les chemins des fichiers concernés doivent permettre leur ouverture dans Obsidian. Une simple réponse dans le chat ne doit pas être présentée comme un texte enregistré : une écriture effective doit être identifiable.
5. Intégration technique
Utiliser l’installation locale de Codex et son authentification existante. Prévoir un réglage du chemin de l’exécutable si sa détection échoue.
Retenir une interface de discussion native au plugin, reliée à codex app-server, plutôt qu’un terminal embarqué. Vérifier le protocole et la compatibilité avec la version installée avant d’implémenter les échanges. Documenter la version effectivement testée.
Gérer démarrage, reprise, interruption, erreurs et arrêt des processus appartenant à Orelius. La fermeture ou le rechargement du plugin ne doit pas laisser de processus inutiles ni arrêter l’instance de développement utilisée dans le terminal.
Si Codex est absent, non authentifié ou incompatible, afficher une explication exploitable. Si une session ne peut pas être reprise, le signaler sans la remplacer silencieusement par une conversation vide.
Les modifications de fichiers doivent être visibles dans Obsidian. Vérifier particulièrement le cas d’une note ouverte et modifiée par l’auteur : éviter l’écrasement silencieux de ses changements.
La première cible est Obsidian desktop sur macOS. Les fichiers du manuscrit restent des fichiers ordinaires du vault. Les réglages et associations de sessions sont conservés par le plugin ; l’historique Codex est repris via ses mécanismes existants.
6. Références à examiner avant de coder
Ces projets servent de références techniques. Orelius doit pouvoir fonctionner sans leur installation. Vérifier leur code actuel et les licences avant toute reprise de composants.
- Codex Panel : référence principale pour la connexion à Codex local, la discussion latérale, le streaming, les conversations et les demandes d’autorisation.
- Codex AI Agent : autre réalisation d’un panneau Obsidian avec contexte de notes, sessions et modifications de fichiers.
- Documentation officielle Codex App Server : référence pour le protocole, les sessions, les événements et les permissions.
L’étude de ces références doit résoudre les besoins de cette version, sans reproduire toutes leurs fonctionnalités.
7. Évolutions prévues, hors première version
L’organisation des dossiers et les fonctions littéraires seront définies au fil du travail. Les évolutions envisagées comprennent les modes Adaptation, Création et Édition ; la comparaison des versions calculée par le plugin ; le rattachement des commentaires (((…))) ; l’analyse des corrections déclenchée par un bouton ; la mémoire éditoriale ; et les signalements à la session de développement.
Ne pas les implémenter maintenant. Séparer simplement la gestion des zones, la connexion Codex et l’affichage afin de pouvoir les faire évoluer. Aucune analyse automatique du manuscrit en arrière-plan.
8. Validation de la première version
La version est utilisable lorsque les vérifications suivantes réussissent :
1. Enregistrer deux dossiers du vault, puis passer de l’un à l’autre.
2. Démarrer une conversation Codex dans chaque zone et vérifier le répertoire réellement utilisé.
3. Depuis le panneau, demander la lecture d’un fichier, puis la création et la modification d’une note de test dans la bonne zone.
4. Retrouver les conversations propres à chaque zone, sans mélange d’historiques ni de fichiers cibles.
5. Redémarrer Obsidian et reprendre une session existante.
6. Interrompre une tâche, puis poursuivre la conversation normalement.
7. Vérifier qu’une écriture extérieure à la zone n’est pas autorisée silencieusement.
8. Vérifier les messages d’erreur pour Codex indisponible et pour un dossier déplacé, ainsi que l’absence de processus Orelius orphelins après désactivation du plugin.
Livrer d’abord ce socle fonctionnel. Les fonctions d’écriture seront construites dessus, à partir de son usage réel.