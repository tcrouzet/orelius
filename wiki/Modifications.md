# Modifier une note et prévenir Codex

[Accueil](Home.md) · [Choisir votre parcours](Home.md)

Vous pouvez modifier directement un chapitre, une scène prévue, un arc, une graine, une fiche de Bible ou une source Model. Au retour dans le chat et avant l’envoi, Orelius compare les fichiers à la dernière version transmise.

## Ce que vous voyez

Un bouton **N fichier(s) à signaler au prochain envoi** apparaît dans le chat lorsque des changements sont détectés. Cliquez dessus pour ouvrir `Manuscript/Context/Modifications.md` : la note liste les fichiers ajoutés, modifiés et supprimés. Un renommage apparaît comme une suppression et un ajout.

Cette note est un registre entretenu par le plugin. Corrigez les documents sources, pas ses empreintes techniques. Le premier contrôle d’un ancien projet peut lister beaucoup de fichiers : ils n’ont pas encore de version de référence transmise.

## Comprendre les conséquences

Le même relevé indique maintenant les scènes, fiches et chapitres potentiellement concernés par une modification. Exemple : vous modifiez `Manuscript/Arcs/Jonas.md` ; la fiche `Manuscript/Scenes/cuisine.md` relie cet arc au chapitre `002.md`. Le relevé présente cette chaîne, avec les chemins et les extraits qui justifient le rapprochement.

- **Lien explicite** : lien entre notes, correspondance définie dans la configuration, ou référence conservée dans un état narratif lié au texte actuel.
- **À vérifier** : le chapitre mentionne le personnage, utilise le chapitre modifié comme raccord précédent, ou une règle partagée de narration a changé. Cela indique où regarder, pas une erreur certaine.

Les liens Markdown, les liens Obsidian et les chemins du projet cités dans les fiches sont reconnus. Un titre court ambigu entre plusieurs notes n’est pas choisi arbitrairement. Les index ne servent pas à propager une modification locale à tout le roman. Les extractions périmées ne servent pas de preuve. L’analyse utilise les liens encore présents et les états valides ; elle ne reconstitue pas un lien supprimé de tous les documents à partir des archives.

Pour rendre le suivi précis, reliez les fiches de scènes à leur chapitre, leurs arcs et leurs intrigues. Peupler reçoit cette consigne. Si le relevé indique « Aucun lien identifié », Codex doit néanmoins examiner votre demande : le plugin ne peut pas déduire toutes les conséquences du sens du texte.

## Ce que reçoit Codex

Votre prochain message ou votre prochaine révision est accompagné de la liste des fichiers changés, des conséquences potentielles documentées et de la consigne de relire leur version actuelle avant de s’appuyer dessus. Le chat et Conversation continuent d’afficher votre demande, sans ajouter la liste technique au texte de votre message.

Les fiches d’atelier sont aussi incluses dans le dossier du chapitre. Modifier une motivation dans Arcs peut donc changer la préparation de la scène, sans vous obliger à recopier cette motivation à chaque demande.

La transmission ne prouve pas la compréhension. Si le modèle interprète mal une correction, dites quelle intention il a inversée et corrigez la fiche correspondante. Une demande de révision détermine les fichiers à écrire ; modifier une fiche ne déclenche pas une réécriture automatique de tout le roman.

## En cas d’erreur ou d’interruption

La file n’est acquittée qu’à la fin réussie de la tâche. Un échec ou une interruption conserve les changements à signaler. Une modification faite après la capture du prochain message reste détectable pour l’envoi suivant. Les fichiers réellement écrits par Codex sont enregistrés comme versions générées, pour ne pas être présentés ensuite comme de nouvelles corrections humaines.

Le registre survit au redémarrage et chaque projet possède le sien. Aucune génération n’est lancée au moment où vous tapez dans une note. Le contrôle est fait au retour dans le chat et à l’envoi.

## Périmètre

Sont suivies les notes Markdown de Manuscript, Model et Bible, notamment les fiches d’atelier, Connaissances.md, la configuration du contexte et ses prompts personnalisés. Les archives, le journal Conversation, les relevés automatiques et les traces générées dans Context sont exclus pour ne pas produire une file qui se remplit avec ses propres écritures. Les liens symboliques et les fichiers cachés ne servent pas de sources.

Les [liens structurés](Structure.md) conservent aussi les identités après les renommages reconnus et les dépendances de fiches absentes ou écartées. Une chaîne devenue périmée reste utile pour signaler une conséquence à vérifier ; elle ne devient pas pour autant un fait actuel du roman. Les décisions enregistrées et les liens sont transmis avec les changements du registre.
