# Relire, réviser et accepter

[Choisir votre parcours](Home.md) : [démarrer](Demarrer.md), [continuer](Continuer.md) ou [adapter](Adapter.md).

Ce cycle commence lorsque vous avez un passage enregistré dans `Manuscript/Chapters/`. Avant cela, suivez le parcours correspondant à votre point de départ.

## 1. Lire le texte enregistré

Ouvrez le chapitre dans Obsidian. C’est ce fichier qui fait référence pour le texte actuel. La réponse du chat doit préciser si le travail a été enregistré ; une proposition refusée par le plugin ne remplace pas le chapitre.

## 2. Indiquer ce qui ne fonctionne pas

Vous avez deux possibilités, qui peuvent se combiner :

- Modifier directement le texte : couper, réécrire, barrer ou ajouter un commentaire `(((destiné à Codex)))`.
- Écrire votre retour dans le chat sans toucher au chapitre.

Exemple de retour :

> Elle ne cherche pas à rassurer sa sœur, elle veut l’empêcher d’ouvrir la lettre. Les répliques doivent agir dans ce sens. Ne transforme pas cette intention en explication du narrateur.

Si votre remarque définit une règle durable, corrigez aussi la fiche concernée dans Arcs, Scenes ou Bible, ou demandez explicitement à Codex d’y enregistrer cette intention. [Les modifications de notes](Modifications.md) sont signalées à la prochaine demande.

## 3. Cliquer sur Réviser

Gardez le chapitre à reprendre ouvert et cliquez sur **Réviser**. Le message éventuellement saisi précise votre demande ; il peut rester vide si vos corrections sont dans le texte.

L’intention peut concerner tout le chapitre, même si votre annotation n’apparaît qu’à un endroit. Codex doit effectuer les raccords nécessaires tout en préservant les passages qui fonctionnent déjà. Le plugin protège les versions et les modifications concurrentes ; la pertinence littéraire reste à juger en lisant le résultat.

Pour repartir intégralement de zéro dans ce chapitre, utilisez **Recommencer** et précisez le résultat recherché. Les versions précédentes restent archivées.

Avant l’enregistrement, un [contrôle séparé](Controle.md) confronte le candidat à l’intention, aux faits et à la voix. Une seule reprise est possible après un refus. Vous lisez la version publiée ; les brouillons ne demandent pas votre intervention. Si le contrôle échoue encore, le chapitre reste en place et le panneau propose de relancer.

## 4. Lire les différences

Les ajouts et remplacements apparaissent sur fond jaune dans l’éditeur ; les suppressions disposent de repères. Aucune balise n’est ajoutée au Markdown. Si le résultat ne convient pas, formulez ce qui reste faux puis recommencez le cycle de révision.

**Effacer le surlignage** retire seulement les repères pour faciliter la lecture. Cela ne signifie pas que le travail est accepté.

## 5. Accepter ce qui fonctionne

Quand le passage vous convient, cliquez sur **Accepter**. Vous pouvez joindre un message, par exemple :

> Voilà ce que je voulais : une menace dans les gestes et les répliques, sans explication supplémentaire.

L’acceptation retire le surlignage et conserve le résultat comme exemple positif. Votre message accompagne cet exemple pour les échanges suivants. Les réactions sous les réponses évaluent les versions produites dans l’échange : pouce levé pour valider, cœur pour en faire une référence forte, pouce baissé pour invalider. Le message saisi précise la portée et les réserves. Les réactions conservent le surlignage et ne restaurent aucun fichier ; Accepter porte sur la version actuellement relue, avec ses éventuelles retouches humaines.

## 6. Passer à la suite

Pour écrire un nouveau chapitre, utilisez **Envoyer** avec la scène ou l’action attendue. Le contexte peut reprendre la voix acceptée et les consignes actives. Après un changement important du projet, [Peupler](Peupler.md) permet d’actualiser les fiches narratives ; il n’est pas nécessaire de le relancer après chaque correction.

## Reprendre seulement un passage

Sélectionnez le passage dans l’éditeur puis choisissez une action Orelius au clic droit : développer, condenser, reformuler, changer de point de vue ou proposer des variantes. Les limites exactes de la sélection protègent le reste du chapitre. Voir [le parcours sur une sélection](Selection.md).

Les fiches peuvent classer les objectifs en `[essentiel]`, `[secondaire]`, `[a-eviter]` et `[suspendu]`. Pendant la révision, Codex utilise vos annotations pour actualiser ces priorités et déclare celles réellement appliquées. Les réactions renforcent ou remettent en question les objectifs d’écriture de Bible/Style introduits ou appliqués dans l’échange : pouce levé +1, cœur +2, pouce baissé −1. Le bloc « Retours sur les priorités », dans la fiche, conserve les points et les sources. Changer d’avis remplace la contribution du même échange. Un avis global ne prouve pas qu’une règle a causé le résultat ; une consigne explicite prime sur les points. Un rejet demande de revoir la règle ou son application. Les réactions ne notent pas les faits, les désirs ou les ambitions des personnages. Vous pouvez modifier les lignes d’objectifs ; préservez le bloc des scores entretenu par Orelius.

## Personnages, documentation et écriture

Placez l’identité, la psychologie, les ambitions, les désirs et les relations dans `Bible/Characters`. Placez les consignes de voix et de rédaction dans `Bible/Style`, en indiquant à quel narrateur ou personnage elles s’appliquent. Les documents sur le monde et leurs sources appartiennent à `Bible/World`. Une critique de phrase ne devient pas une caractéristique psychologique.

Les liens de `Bible/Projet.md`, de votre demande et des références retenues sont présentés à Codex pendant la préparation. Il doit les consulter lorsqu’ils sont pertinents ou expliquer leur indisponibilité ou leur absence de rapport avec la demande. Il peut compléter cette documentation par une recherche web, notamment pour des événements ou publications liés à la date du récit. Aucune recherche n’est imposée artificiellement à un texte qui n’en a pas besoin.

Dans `Manuscript/Context/<chapitre>/preparation.md`, vous pouvez consulter séparément les motivations et connaissances des personnages, les sources externes et leurs extraits, les choix d’écriture et les opérations de la scène. Ces traces sont destinées au travail automatique : vous n’avez pas à lire ni à valider les brouillons. Les extraits sont transmis au contrôle de publication. Leur consultation est déclarée par Codex ; Orelius vérifie la présence et la structure des justificatifs, pas leur authenticité sur le Web. Une information documentée ne devient pas automatiquement un fait du récit ni une connaissance d’un personnage.
