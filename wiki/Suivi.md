# Suivi et continuité

[Accueil](Home.md)

## Après une écriture

Orelius contrôle les états des chapitres et conserve la liste des états manquants ou périmés dans `Manuscript/Context/suivi-etats.md`. Après une écriture réussie, il peut lancer une passe supplémentaire d’extraction dans la même session. Cette passe peut consulter le contexte et enregistrer les états ; l’écriture libre des fichiers, notamment du manuscrit, lui est refusée.

Une seule passe supplémentaire est lancée par demande. Une interruption, une erreur ou un état encore absent reste signalé : pas de boucle de relances. La commande **Orelius : Actualiser les états narratifs** permet aussi de reprendre les états existants ou de traiter un ancien projet. Elle utilise le modèle et son quota. Pendant cette passe, le message suivant reste saisissable mais son envoi attend la fin du suivi.

Le journal Conversation et le chat conservent vos demandes et les réponses finales éditoriales. Les instructions internes d’extraction en sont exclues. Les fichiers de contexte rendent leur résultat visible.

## État d’un chapitre

`etat.md` contient un résumé, des faits, leurs citations, les personnages qui les connaissent et les moments narratifs. L’empreinte du texte et celles des chapitres utilisés comme dépendances permettent de repérer les analyses périmées. Une ancienne interprétation n’est pas réutilisée comme un état actuel lorsque ces empreintes divergent.

Chaque fait doit citer exactement le chapitre. Si la citation apparaît plusieurs fois, `at` indique la position UTF-16 immédiatement après l’occurrence voulue. Les méthodes appliquées à une sélection peuvent ne recevoir que les faits déjà acquis avant cette sélection, filtrés par `acteur` et `knownBy`. Ce filtre dépend de l’extraction correcte par le modèle ; une citation réelle ne prouve pas que son interprétation est juste.

## Chronologie

Un moment porte un identifiant, une citation et une description. Il peut préciser `at`, `duration`, `unit` (`seconds`, `minutes`, `hours`, `days`). `after` désigne un autre moment du chapitre ou `Manuscript/Chapitres/001.md#moment` ; `offset` mesure le décalage depuis le **début** de ce moment. Les résultats sont convertis en secondes.

Le calcul détecte cycles, références manquantes et contradictions entre une position explicite et une position relative. Des origines relatives indépendantes restent indépendantes. Le plugin n’invente ni date civile ni durée : sans preuve dans le texte, le modèle doit laisser ces valeurs indéterminées. Les conflits des états précédents apparaissent dans le dossier de contexte.

## Si le suivi reste incomplet

Consultez `suivi-etats.md`, puis relancez la commande d’actualisation. Si une citation ou un chemin est invalide, corrigez la source ou la configuration. Si le chapitre a changé, il faut une extraction du texte actuel. Un suivi incomplet ne supprime pas le chapitre déjà enregistré et ne l’autorise pas à être remplacé par une ancienne proposition.
