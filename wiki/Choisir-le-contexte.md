# Choisir les notes pour une demande

[Accueil](Home.md) · [Organisation](Contexte.md) · [Agir sur une sélection](Selection.md)

## Préparer l’envoi

1. Ouvrez le chapitre à travailler et saisissez votre demande dans le chat.
2. Cliquez sur **Contexte**. Orelius affiche les notes retenues pour ce chapitre et cette demande, leur raison et le nombre de caractères utilisés.
3. Recherchez une note par son nom ou son chemin. Cochez-la pour l’ajouter ; décochez-la pour la retirer de cette demande. Les choix sont enregistrés à la volée.
4. Fermez la fenêtre, puis utilisez **Envoyer**, **Réviser**, **Recommencer** ou une action sur sélection du même chapitre.

Le bouton affiche le nombre de choix explicites en attente. Ils sont consommés lorsque la demande est envoyée avec succès. La demande suivante retrouve la sélection automatique. **Revenir au choix automatique** retire vos choix en attente. Un changement de projet les efface. Si vous passez à un autre chapitre, rouvrez Contexte pour préparer sa sélection.

Sans chapitre ouvert, le bouton prépare le contexte d’un échange général : vous pouvez aussi y ajouter une note du projet ou retirer une référence proposée.

## Pourquoi une note est utilisée

Les raisons distinguent notamment :

- le texte conservé du chapitre et son prédécesseur ;
- le plan et le texte Model associés au chapitre ;
- les consignes de narration, de style et les retours actifs ;
- une référence configurée comme obligatoire ou liée au point de vue ;
- un nom ou un alias détecté dans la demande ou les textes de contexte ;
- une fiche liée aux scènes du chapitre ;
- une note ajoutée explicitement pour cette demande.

Les fiches d’atelier ne sont plus envoyées en bloc. Orelius retient les fiches reliées aux scènes du chapitre ou mentionnées dans la demande, le chapitre ou son plan. Les fiches écartées dans la structure ne reviennent pas automatiquement. Vous pouvez cependant en ajouter une explicitement pour la discuter. Les documents Model et les fiches d’atelier restent des sources d’adaptation ou des intentions, jamais des faits déjà acquis dans le roman.

Les liens transmis dans le dossier sont limités aux notes sélectionnées. Pour une demande ciblant un chapitre, la notification des fichiers modifiés est également limitée aux sources de ce dossier. Les modifications non transmises restent en attente.

## Ce qui reste indispensable

Le chapitre à modifier, la configuration et le registre de structure servent au ciblage et aux contrôles. Leurs cases sont désactivées. Les consignes techniques de la tâche et les différences de correction associées au chapitre ne sont pas des notes facultatives.

Les autres retraits valent pour cette demande : ils ne changent pas la configuration générale du projet. Retirer une note enlève aussi ses différences associées et écarte les résumés dont elle est une dépendance déclarée. Cela peut réduire la continuité disponible ; l’aperçu permet de vérifier ce qui reste.

## Comprendre la taille

La taille est celle du dossier préparé, en caractères. Elle ne mesure ni les tokens exacts ni l’historique déjà présent dans la session Codex. Certains documents ne sont transmis qu’en extraits : consignes actives, exemple de voix accepté ou sections autorisées par la configuration.

Les notes écartées par le budget des références sont signalées. Si une note obligatoire ou ajoutée explicitement dépasse ce budget, l’aperçu affiche le problème ; retirez une référence ou ajustez les budgets dans la configuration. Orelius refuse un dossier trop volumineux au lieu de le tronquer silencieusement.

L’aperçu utilise le message actuel. Si vous le modifiez ensuite, cliquez sur **Actualiser l’aperçu**. La sélection automatique est recalculée lors de l’envoi et de la consultation du dossier ; vos ajouts et retraits explicites restent applicables.

## Relance, traces et limites

Une relance conserve les choix de la demande échouée, même après réouverture de la conversation. Elle ne reprend pas ceux que vous auriez préparés pour une autre demande.

Pour un chapitre, `Manuscript/Context/<chapitre>/sources.md` conserve les sources réellement préparées et leur raison. Ce relevé est actualisé lorsque Codex consulte son dossier. Les noms de dossiers suivent vos réglages.

Retirer une note empêche son ajout au nouveau dossier ; cela n’efface pas ce qui a déjà été transmis dans la conversation, ni les mentions éventuelles contenues dans d’autres notes. Ce sélecteur ne constitue pas une restriction de lecture des fichiers par tous les outils de Codex.

**Peupler** et l’actualisation globale des états narratifs conservent leur fonctionnement propre : ils doivent examiner leurs matériaux. Les choix du bouton Contexte concernent l’envoi éditorial et les actions sur sélection ; ils ne filtrent pas ces opérations globales et ne s’appliquent pas à une consigne envoyée pendant une tâche déjà en cours.
