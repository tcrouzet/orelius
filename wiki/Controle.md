# Contrôle avant publication

[Accueil](Home.md) · [Réviser et accepter](Travailler.md)

## Votre parcours reste le même

Demandez un passage avec **Envoyer**, **Réviser** ou **Recommencer**. Orelius prépare les sources et laisse Codex rédiger. Quand Codex demande l’enregistrement du chapitre, Orelius fait évaluer ce candidat dans une session séparée, avec le même modèle actif.

Vous n’avez pas à lire les brouillons. Le panneau indique **Contrôle avant publication…**. Le texte dans Chapitres reste en place pendant cette évaluation. Pour un nouveau chapitre, le fichier n’est créé qu’après un contrôle favorable.

## Ce qui est vérifié

- **Intention** : la version répond-elle à la demande, aux corrections et à la préparation de la scène ?
- **Faits** : les actions, relations, connaissances et antécédents sont-ils compatibles avec les sources actuelles ? Les acteurs et référents sont-ils intelligibles ?
- **Voix** : le passage respecte-t-il la référence acceptée et les consignes de narration ?

Son prompt est visible dans `prompts/controler-publication.md` et sa version rendue est conservée dans le dossier Context du chapitre. Le contrôleur reçoit le candidat, la préparation et les sources du dossier. Il ne participe pas à la conversation de rédaction et ne dispose pas de l’outil d’écriture d’Orelius. Ses conclusions doivent citer exactement le candidat et une source disponible.

Le plugin refuse une preuve factuelle tirée seulement du plan, de Model, de la préparation ou d’un ancien exemple de voix. Une voix acceptée doit servir de référence lorsqu’elle figure dans le dossier. Sinon, le contrôle s’appuie sur les consignes disponibles et doit signaler cette limite. Si aucune source factuelle admissible n’existe, seule la cohérence interne du candidat peut être contrôlée ; cela n’établit aucun passé du récit.

## Une seule reprise automatique

Si le premier contrôle signale un défaut, le candidat n’est pas enregistré dans Chapitres. Codex reçoit les problèmes cités et peut soumettre une version corrigée, dans la portée d’écriture déjà autorisée. Orelius contrôle cette seconde version.

Il y a au maximum deux évaluations par chapitre pour une demande : le candidat initial, puis une reprise. Renvoyer à l’identique un candidat refusé arrête la publication sans payer une nouvelle évaluation. Relire le dossier ou refaire la préparation ne remet pas cette limite à zéro. Une nouvelle consigne envoyée par l’auteur invalide le contrôle en cours et ouvre une nouvelle préparation.

Si la seconde version est encore refusée, ou si le contrôle est invalide, indisponible ou interrompu, la version du chapitre encore en place est conservée. Le panneau signale que la publication n’a pas abouti et propose **Relancer** une fois la tâche terminée. Une relance est votre décision ; le plugin ne lance pas une succession de réécritures.

Chaque évaluation dispose de trois minutes au maximum, connexion comprise. **Arrêter** interrompt aussi le contrôleur. Une modification des sources pendant le contrôle interdit la publication depuis ce dossier périmé. Ces évaluations ajoutent du temps et de la consommation Codex à la rédaction.

## Après un contrôle favorable

Orelius archive l’original et la version générée, puis écrit le chapitre. Les différences restent surlignées selon le fonctionnement habituel. Vous lisez cette version et décidez si elle vous convient. **Accepter** reste votre validation : le contrôle automatique ne la remplace pas.

## Où retrouver les traces

Pour un chapitre `Manuscript/Chapitres/002.md`, les traces sont dans `Manuscript/Context/002/Publication/` :

- `candidat-1.md` et, si nécessaire, `candidat-2.md` ;
- `controle-1.md` et, si nécessaire, `controle-2.md`.

Une nouvelle demande archive les traces remplacées. Ce dossier est exclu des sources narratives habituelles et du peuplement : un brouillon refusé ne doit pas devenir un événement acquis ou un exemple accepté. Il reste visible pour un diagnostic, sans exiger votre lecture.

## Limite du contrôle

Le code vérifie les citations, les catégories de sources, la fraîcheur du dossier, la limite de reprise et l’autorisation d’écriture. Le jugement littéraire reste celui d’un modèle : il peut manquer un défaut ou en signaler un à tort. Le contrôle séparé vise à réduire les erreurs avant votre lecture ; il ne garantit pas qu’un passage soit réussi.
