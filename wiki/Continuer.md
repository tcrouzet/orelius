# Continuer un manuscrit

[Les trois parcours](Home.md)

**Vous avez déjà des chapitres qui constituent le texte actuel du roman.** Vous voulez écrire la suite ou reprendre certains passages en conservant cette continuité.

## 1. Ranger le texte actuel

Placez vos notes de chapitres dans `Manuscript/Chapitres/`, par exemple `001.md`, `002.md`. Utilisez des notes Markdown : ces étapes ne décrivent pas un import automatique de Word ou d’EPUB.

Les notes de plan vont dans `Manuscript/Plan/`, au même niveau que `Chapitres`. Les fiches générales des personnages vont dans `Bible/Personnages/`. Les règles de voix vont dans `Bible/Style/Narration.md`. Vous pouvez commencer avec seulement le texte : les autres documents se complètent au fil du travail.

`Model/` peut rester vide. Si vous avez d’anciennes versions utiles à consulter, placez-les dans Model et précisez leur rôle. Les chapitres de Manuscript restent la référence pour ce qui est effectivement écrit.

## 2. Faire le point avec Peupler

Cliquez sur **Peupler** dans le chat. Codex lit le texte actuel et les autres sources disponibles, puis remplit les fiches de synopsis, scènes, arcs et intrigues. Il ne réécrit aucun chapitre pendant cette action.

Consultez les points utiles dans `Manuscript/Verification/index.md` et corrigez une fiche si elle inverse une intention ou confond un projet avec un fait. Pas besoin de valider toutes les fiches. Vos changements seront signalés lors de la prochaine demande.

## 3. Écrire la suite

Si `002.md` est votre dernier chapitre, créez ou ouvrez `Manuscript/Chapitres/003.md`. Les noms de fichiers définissent l’ordre par défaut ; le [guide du contexte](Contexte.md) explique comment choisir un autre ordre.

Avec **Envoyer**, demandez par exemple :

> Écris l’ouverture de 003 en continuité avec la fin conservée de 002. La narratrice apporte la lettre à sa sœur et tente de lui faire reconnaître l’écriture. Sa sœur refuse de répondre et lui demande de quitter la maison. Respecte la voix de Narration.md. Enregistre le résultat dans Manuscript/Chapitres/003.md.

Indiquez l’action et son enjeu, ou renvoyez à une scène déjà préparée. Une demande de continuation ne doit pas obliger le modèle à deviner quel texte fait référence ni quelle action vous attendez.

## 4. Retravailler un chapitre existant

Ouvrez le chapitre concerné. Corrigez directement le texte ou ajoutez des commentaires `(((...)))`. Vous pouvez aussi expliquer le problème uniquement dans le chat :

> La sœur veut empêcher la vente, pas protéger la narratrice. Reprends les décisions et les répliques qui contredisent cette intention dans le chapitre. Préserve ce qui fonctionne déjà.

Cliquez sur **Réviser**. Votre remarque guide les corrections et les raccords nécessaires dans le chapitre entier. Pour réutiliser une intention dans la suite du roman, inscrivez-la également dans la fiche d’arc ou demandez explicitement de l’y enregistrer.

## 5. Continuer le travail

Suivez le cycle [relire, Réviser, Accepter](Travailler.md). Après plusieurs chapitres nouveaux ou un changement important du plan, relancez Peupler pour actualiser les fiches de l’atelier. Une petite correction de fiche suffit à alimenter la file des changements ; elle ne nécessite pas un nouveau peuplement.
