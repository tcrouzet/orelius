# Prompts et méthodes

[Accueil](Home.md)

Les modèles de tâches sont visibles dans [prompts](../prompts/). Le dossier du chapitre conserve leurs versions rendues dans `prompts.md`. Ils couvrent préparation de scène, rédaction, révision, continuité, suivi, idées, synopsis, plan, découpage de scène, résumé, développement, reformulation, condensation, critique, extraction du style, adaptation, Bible, description et continuation.

Le modèle appelle `consulter_methode` avec la tâche, une consigne et éventuellement une sélection `debut`/`fin`, un `lot` ou un `acteur`. La sélection utilise les positions UTF-16 du texte courant ; le résultat comprend le voisinage du passage. Cet outil expose une méthode : il ne déclenche pas automatiquement un modèle indépendant par tâche.

## Composer les prompts

Variables disponibles : `{chapter}`, `{contextPath}`, `{preparationPath}`, `{manuscriptFolder}`, `{bibleFolder}`, `{modelFolder}`, `{pov}`, `{tense}`. Les deux dernières proviennent de la configuration du chapitre.

```text
{if:pov}Respecte ce point de vue : {pov}.{else}Vérifie le point de vue dans Narration.md.{/if}
{if:tense}Temps narratif : {tense}.{/if}
```

Une condition vérifie que la variable n’est pas vide ; ce n’est pas un langage de programmation. Les conditions peuvent être imbriquées. Les variables inconnues et blocs mal fermés sont refusés. `{include:controler-continuite}` inclut une autre méthode ; les cycles sont refusés.

Dans `configuration.md`, `methods` peut préciser `instructions`, `persona` et `targetWords` par nom de tâche. Ces paramètres enrichissent les consignes ; un nombre de mots cible n’est pas une garantie de longueur.

## Revue reprenable

Pour une revue longue, `revoir_lots` découpe le texte en groupes de paragraphes et conserve l’avancement dans `revue.md`.

1. `ouvrir` retrouve le premier lot incomplet de la version courante.
2. Le modèle lit le lot et son voisinage puis identifie les problèmes réels.
3. `terminer` enregistre les remarques (`quote`, `issue`, `suggestion`), avec l’empreinte et le numéro du lot. Une liste vide signifie que le modèle n’a pas relevé de problème.
4. Le prochain lot est retourné ; `suivant` permet de le consulter à nouveau.

Les lots doivent être terminés dans l’ordre et les citations appartenir au lot. Une modification du manuscrit bloque la continuation jusqu’à une nouvelle ouverture ; l’ancienne revue est archivée. Cette revue produit des propositions, jamais une modification automatique du chapitre. L’avancement survit à une reprise de session ; son exécution complète dépend des appels du modèle.

## Accès depuis l’éditeur

Les actions de sélection sont accessibles au clic droit dans un chapitre et dans la palette de commandes. Développer, condenser et reformuler utilisent leurs méthodes dédiées. Le changement de point de vue utilise reformuler avec la cible demandée ; les variantes utilisent idees avec une demande de trois passages rédigés. Le [guide de sélection](Selection.md) précise les protections et le parcours.
