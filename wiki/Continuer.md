# Continuer un manuscrit

[Les trois parcours](Home.md)

**Vous avez déjà des chapitres qui constituent le texte actuel du roman.** Vous voulez écrire la suite ou reprendre certains passages en conservant cette continuité.

## 1. Ranger le texte actuel

Créez un **Nouveau projet Orelius** depuis le menu contextuel du dossier parent dans l’explorateur. Copiez tous vos matériaux dans `Model/`, avec votre organisation : chapitres, brouillons, plan et notes. Utilisez des notes Markdown ; l’import Word, PDF ou EPUB n’est pas pris en charge par Peupler.

Précisez dans une note de Model quelles versions constituent votre manuscrit actuel et lesquelles sont des brouillons ou d’anciennes pistes. Peupler peut installer les chapitres manquants par copie exacte puis extraire les fiches de la Bible et du manuscrit. Si vous avez déjà placé des chapitres dans `Manuscript/Chapters/`, ils restent conservés.

## 2. Faire le point avec Peupler

Dans l’explorateur, cliquez sur **Peupler** à côté du dossier **Model**. Codex lit le texte actuel et les autres sources disponibles, puis remplit les fiches de synopsis, scènes, arcs et intrigues. Il ne réécrit aucun chapitre pendant cette action.

Consultez les points utiles dans `Manuscript/Checks/index.md` et corrigez une fiche si elle inverse une intention ou confond un projet avec un fait. Pas besoin de valider toutes les fiches. Vos changements seront signalés lors de la prochaine demande.

## 3. Écrire la suite

Si `002.md` est votre dernier chapitre, créez ou ouvrez `Manuscript/Chapters/003.md`. Les noms de fichiers définissent l’ordre par défaut ; le [guide du contexte](Contexte.md) explique comment choisir un autre ordre.

Avec **Envoyer**, demandez par exemple :

> Écris l’ouverture de 003 en continuité avec la fin conservée de 002. La narratrice apporte la lettre à sa sœur et tente de lui faire reconnaître l’écriture. Sa sœur refuse de répondre et lui demande de quitter la maison. Respecte la voix de Narration.md. Enregistre le résultat dans Manuscript/Chapters/003.md.

Indiquez l’action et son enjeu, ou renvoyez à une scène déjà préparée. Une demande de continuation ne doit pas obliger le modèle à deviner quel texte fait référence ni quelle action vous attendez.

## 4. Retravailler un chapitre existant

Ouvrez le chapitre concerné. Corrigez directement le texte ou ajoutez des commentaires `(((...)))`. Vous pouvez aussi expliquer le problème uniquement dans le chat :

> La sœur veut empêcher la vente, pas protéger la narratrice. Reprends les décisions et les répliques qui contredisent cette intention dans le chapitre. Préserve ce qui fonctionne déjà.

Cliquez sur **Réviser**. Votre remarque guide les corrections et les raccords nécessaires dans le chapitre entier. Pour réutiliser une intention dans la suite du roman, inscrivez-la également dans la fiche d’arc ou demandez explicitement de l’y enregistrer.

## 5. Continuer le travail

Suivez le cycle [relire, Réviser, Accepter](Travailler.md). Relancez Peupler après avoir ajouté de nouveaux documents dans Model. Pour actualiser les fiches après un changement du manuscrit ou du plan, demandez-le dans le chat. Une petite correction de fiche suffit à alimenter la file des changements ; elle ne nécessite pas un nouveau peuplement.
