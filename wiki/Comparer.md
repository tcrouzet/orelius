# Comparer, choisir et restaurer

[Accueil](Home.md) · [Agir sur une sélection](Selection.md) · [Réviser et accepter](Travailler.md)

## Choisir entre plusieurs propositions

1. Sélectionnez un passage du chapitre, puis faites un clic droit → **Orelius : Proposer des variantes**. Ajoutez votre intention et envoyez.
2. Après la réponse, cliquez sur **Comparer** dans le chat. Vous pouvez aussi utiliser **Orelius : Comparer les versions** depuis le menu de l’éditeur ou la palette de commandes.
3. Choisissez les versions à gauche et à droite. Le texte actuel, les propositions enregistrées et les archives du chapitre sont disponibles.
4. Cochez les changements à prendre dans la version de droite. Les changements non cochés gardent le texte de gauche. Ouvrez **Aperçu du résultat complet**, puis cliquez sur **Appliquer le résultat**.

La version de gauche est le point de départ du résultat. Si vous choisissez une proposition à gauche, ses différences avec le texte actuel feront donc partie du résultat, même sans cocher de changement à droite. Pour ne modifier que certains endroits du texte actuel, gardez **Texte actuel** à gauche.

Les changements sont proposés par groupes de différences textuelles. Vous pouvez assembler deux propositions, mais Orelius ne réécrit pas leurs raccords après votre choix : relisez l’aperçu. L’application est une décision directe de l’auteur et ne lance pas une nouvelle génération ni un contrôle par modèle.

Le texte remplacé et le résultat sont archivés. Les changements apparaissent dans le chapitre avec le surlignage habituel. Le choix rejoint le suivi avec les différences retenues ; il n’est pas interprété comme une approbation générale du chapitre. **Accepter** reste disponible pour approuver la version et retirer son surlignage.

## Retrouver une ancienne version

Ouvrez **Comparer**, choisissez une archive dans **Version comparée**, à droite, puis lisez-la. Cliquez sur **Restaurer cette archive** pour remplacer le chapitre entier. Le texte actuel est archivé avant remplacement : vous pourrez le retrouver dans la même liste.

Pour récupérer seulement quelques passages d’une archive, gardez **Texte actuel** à gauche et cochez les différences voulues, puis utilisez **Appliquer le résultat**.

## Si le texte a changé

Une proposition est liée au chapitre exact qui a servi à sa génération. Si vous avez retouché ce chapitre, elle porte la mention **ancienne version** : elle reste lisible, mais ne peut plus être appliquée. Demandez de nouvelles variantes sur le texte conservé.

Si le chapitre change pendant que la comparaison est ouverte, Orelius refuse le remplacement. Fermez puis rouvrez la comparaison. Une tâche en cours empêche également l’application.

## Où sont conservées les propositions ?

Les nouvelles variantes sont enregistrées dans `Manuscript/Context/<chapitre>/Variantes/`, sous forme de fichiers Markdown horodatés. Elles restent des propositions, séparées du texte conservé. Le bloc de données en fin de fichier contient les textes utilisés par le comparateur ; ne modifiez pas seulement leur présentation au-dessus.

Les anciennes réponses du chat, produites avant cette fonctionnalité, ne sont pas converties automatiquement. Les archives existantes du chapitre sont disponibles directement. Les noms de Manuscript et Archives suivent vos réglages.
