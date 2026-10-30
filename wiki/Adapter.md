# Adapter un manuscrit

[Les trois parcours](Home.md)

**Vous partez d’un texte que vous voulez transformer.** Il peut s’agir d’une ancienne version de votre roman ou d’un texte source dont vous voulez modifier la narration, les personnages, l’époque, la structure ou la direction.

Le texte source se trouve dans **Model**. Le nouveau texte se construit dans **Manuscript**. Cette séparation permet de consulter l’original pendant que la nouvelle version évolue.

## 1. Placer le texte source

Rangez les chapitres sources en notes Markdown dans `Model/Chapitres/`, par exemple `001.md`, `002.md`. Les plans et résumés associés peuvent aller dans `Model/Plan/` et `Model/Resume/`, au même niveau que `Chapitres`.

Si aucune nouvelle version n’est écrite, laissez `Manuscript/Chapitres/` vide. Si vous avez déjà commencé l’adaptation, placez uniquement cette nouvelle version dans Manuscript. Il n’est pas nécessaire de copier tout le texte source dans les deux dossiers.

## 2. Définir la transformation

Créez `Manuscript/Seeds/adaptation.md`. Indiquez ce que vous voulez garder, changer et éviter. Par exemple :

> Source : Model/Chapitres. Conserver l’intrigue de la maison et de la lettre. Raconter désormais à la première personne, du point de vue de la sœur. Elle veut empêcher la vente, mais ignore qui envoie les lettres. Supprimer les scènes où elle ne peut pas être présente. Ne pas lui attribuer les connaissances de l’ancienne narratrice.

Dans `Bible/Style/Narration.md`, précisez la voix et le mode narratif de la nouvelle version. Les fiches de Bible doivent décrire vos choix pour cette version. Les informations de l’original ne deviennent pas automatiquement des faits du nouveau roman.

## 3. Préparer l’adaptation avec Peupler

Cliquez sur **Peupler**. Codex organise les sources et vos intentions dans les fiches de Manuscript : synopsis, scènes à conserver ou transformer, arcs, intrigues et points à résoudre. Model reste intact ; aucun chapitre n’est réécrit pendant cette étape.

Vérifiez surtout les décisions qui changent le sens du récit. Si une fiche reprend une intention de l’original que vous avez abandonnée, corrigez-la avant de demander la prose. La modification sera signalée à Codex avec votre demande suivante.

## 4. Adapter un premier passage

Créez ou ouvrez `Manuscript/Chapitres/001.md`. Avec **Envoyer**, demandez :

> Adapte Model/Chapitres/001.md dans Manuscript/Chapitres/001.md selon Seeds/adaptation.md et la nouvelle Narration. La sœur raconte uniquement ce qu’elle voit, sait ou suppose. Conserve la découverte de la lettre, mais transforme la scène pour respecter ce point de vue. Préserve le fichier source.

Avec les noms par défaut, le dossier de contexte de `Manuscript/Chapitres/001.md` consulte `Model/Chapitres/001.md`. Si la correspondance change, indiquez le bon fichier dans le champ `model` de la [configuration du chapitre](Contexte.md). Vous pouvez ainsi adapter une source vers un chapitre portant un autre nom.

Le nouveau texte est enregistré dans Manuscript. Model reste la référence de départ ; les changements apportés à la nouvelle version sont archivés dans Archives.

## 5. Poursuivre la nouvelle version

Relisez le résultat puis utilisez [Réviser et Accepter](Travailler.md). Pour les passages suivants, distinguez toujours la source Model des chapitres de l’adaptation déjà écrits dans Manuscript. Ces derniers établissent la continuité de la nouvelle version.

Si vous changez la direction de l’adaptation, modifiez la graine et les fiches concernées. La prochaine demande recevra le signalement de ces changements. Relancez Peupler si vous voulez remettre l’ensemble des fiches en cohérence avec cette nouvelle direction.
