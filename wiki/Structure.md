# Relier les idées aux passages écrits

[Accueil](Home.md) · [Peupler](Peupler.md) · [Modifications](Modifications.md)

La [vue d’ensemble du roman](Roman.md) permet de parcourir les actes, chapitres et scènes, de changer leur emplacement prévu et de consulter ces liens.

## Choisir une idée et la suivre

1. Déposez une idée dans une fiche de `Manuscript/Seeds`, par exemple `Le témoin ment.md`. Une fiche contient une idée distincte ; `index.md` sert de sommaire.
2. Ouvrez le chat ou utilisez **Peupler**. Orelius attribue des identifiants aux fiches présentes ; Peupler peut créer les fiches manquantes et les relier depuis vos matériaux.
3. Ouvrez la fiche de l’idée. Dans le chat, **Cette fiche** propose **Proposition**, **Retenue**, **Écartée**. Choisissez **Retenue** pour indiquer votre direction. Ce choix sera joint à la prochaine demande ; il ne lance aucune génération.
4. Demandez, par exemple : « Développe cette idée dans le plan du chapitre 3, puis prépare les scènes. Relie les fiches. » Codex enregistre les liens entre graine, plan et scènes.
5. Demandez la rédaction du chapitre. Après enregistrement, Codex peut relier chaque scène à un passage exact du chapitre. Vous pouvez retrouver la chaîne dans `Manuscript/Context/Structure.md`.

Ces noms de dossiers utilisent les réglages par défaut. Le dossier Manuscript porte le nom choisi dans les paramètres. Plan et Scenes sont au même niveau que Chapitres.

## Ce que signifie chaque lien

- **developpe** : une graine est développée dans une fiche de plan.
- **planifie** : une fiche de plan prévoit une scène.
- **implique** : un personnage, une intrigue ou un arc intervient dans une scène.
- **realise** : une scène est reliée à une citation du chapitre conservé.

Une scène peut être reliée à plusieurs personnages et intrigues. Un plan peut prévoir plusieurs scènes. Pour distinguer plusieurs scènes d’un chapitre, utilisez une fiche par scène dans Scenes. Le lien de réalisation conserve une citation et sa position dans le texte ; aucune balise n’est ajoutée au roman.

Le plugin vérifie les identifiants, les types de liens, les versions des sources et la présence de la citation. Codex interprète le sens du passage. Une réalisation ne prouve donc ni la qualité de la scène ni votre satisfaction : **Accepter** reste l’action qui valide le texte généré.

## Vos décisions

**Retenue** signifie que vous avez choisi la fiche comme direction de travail. **Écartée** la conserve avec son identité et ses liens pour éviter qu’elle revienne sans votre accord. **Proposition** retire la décision de retenir ou d’écarter. Le sélecteur apparaît pour une fiche de graine, plan, scène, personnage, intrigue ou arc ; il ne remplace pas l’acceptation d’un chapitre.

Les fiches nouvellement détectées commencent comme propositions, même si leur contenu dit « retenu ». Codex ne peut pas changer ce statut par ses outils. Une demande dans le chat reste une consigne de travail ; utilisez le sélecteur pour enregistrer durablement votre choix. Le choix porte sur la fiche : éditer son contenu ne remet pas automatiquement son statut à zéro.

## Après une correction ou un renommage

Une modification de fiche conserve son identifiant et sa décision. Les liens qui dépendaient de son ancien contenu deviennent **à revalider**. Ils restent dans le relevé des conséquences pour que Codex puisse vérifier les scènes et passages concernés. Aucun autre chapitre n’est réécrit automatiquement.

Une citation unique déplacée dans un chapitre reste identifiable. Une citation supprimée ou devenue ambiguë demande une nouvelle vérification. Si la même phrase apparaît plusieurs fois dès l’enregistrement du lien, sa position exacte permet de choisir l’occurrence ; un changement ultérieur du chapitre exige de revalider ce choix.

Les renommages de notes ou de sous-dossiers dans Obsidian conservent les identifiants lorsque la catégorie reste la même et que la destination ne possède pas déjà une identité. Un déplacement hors Obsidian est reconnu seulement si le contenu est identique et le rapprochement unique. Une copie reçoit un autre identifiant. Un déplacement accompagné d’une modification hors Obsidian, ou plusieurs fiches au contenu identique, ne permet pas un rapprochement sûr : l’ancienne identité reste signalée absente et la nouvelle fiche reçoit une identité distincte. Déplacer une fiche d’une catégorie à une autre ne conserve pas automatiquement son identité.

Les fiches supprimées restent signalées **absentes** dans le registre. Cela permet de retrouver leurs anciennes dépendances sans inventer leur contenu.

## Lire le registre

`Manuscript/Context/Structure.md` contient une liste lisible et un bloc JSON avec identifiants, chemins, décisions, empreintes et liens. Ce bloc fait foi ; changer uniquement le résumé au-dessus ne change pas les décisions. Les mises à jour du registre archivent sa version précédente. Un bloc invalide est conservé et signalé, jamais remplacé silencieusement.

Le dossier de contexte préparé pour un chapitre contient les décisions et liens avec leur état actuel. Les nouveaux liens restent proposés par Codex : un graphe complet n’est pas un contrôle littéraire. Pour contrôler une idée, demandez : « Montre où cette idée retenue est développée dans le plan et réalisée dans le texte ; signale ce qui manque. »
