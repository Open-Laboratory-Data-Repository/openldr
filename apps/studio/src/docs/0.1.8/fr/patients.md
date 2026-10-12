# Patients

L'index des patients liste les patients que CE a reçus avec les données du laboratoire. Le système source, par exemple un HIMS, possède chaque patient. CE affiche les patients et ne les modifie jamais.

Ouvrez **Patients** dans la barre latérale. Il faut l'autorisation Voir l'index des patients.

## Ce que vous voyez

Sans l'autorisation Voir les identifiants des patients, les noms et les identifiants sont masqués. Un nom affiche sa première lettre, par exemple `J*** M***`. Un identifiant affiche ses quatre derniers caractères. Vous voyez l'année de naissance, pas la date, et ni téléphone ni e-mail. La recherche ne trouve alors qu'un identifiant exact, car une recherche sur une partie du nom révélerait les noms lettre par lettre.

Avec Voir les identifiants des patients, vous voyez tout, et la recherche trouve aussi une partie d'un nom. Chaque liste et chaque patient ouvert est inscrit au journal d'audit. Le journal enregistre combien de patients correspondent, jamais ce que vous avez cherché.

## Trouver un patient

Saisissez un identifiant, par exemple un numéro MPI ou un identifiant national, et CE trouve le patient quel que soit l'identifiant. Utilisez **Filtrer** et **Statut** pour afficher les dossiers fusionnés.

La colonne **Identifiants** affiche les systèmes choisis dans l'onglet **Systèmes d'identifiants**.

## La fiche d'un patient

Cliquez sur une ligne, ou choisissez **Voir** dans son menu ⋯. La fiche affiche les informations du patient, chaque identifiant avec son libellé, et ses demandes de laboratoire, de la plus récente à la plus ancienne. Si le dossier a été fusionné dans un autre, choisissez **Ouvrir le patient dans lequel ce dossier a été fusionné** dans le menu ⋯.

Si la fiche indique que la liste n'est plus à jour, le serveur a redémarré. Rechargez la page.

## Systèmes d'identifiants

Chaque identifiant arrive avec un système, une URI qui indique de quel type d'identifiant il s'agit. Cet onglet liste chaque système vu par CE, avec le nombre de patients qui le portent.

Avec l'autorisation Gérer l'index des patients, choisissez **Modifier** dans le menu ⋯ d'une ligne pour donner un libellé au système, par exemple NRC ou numéro ART. Laissez le libellé vide pour utiliser le nom envoyé par le système source. **Afficher dans la liste** l'ajoute à la colonne Identifiants. **La recherche le trouve** permet de chercher les patients par cet identifiant. Choisissez **Enregistrer** dans le menu ⋯ de la fiche.

Un laboratoire qui reçoit ces libellés du central ne peut pas les modifier.

## Après la mise à jour

Les patients reçus avant cette version n'ont aucun identifiant listé tant que vous n'avez pas lancé `openldr db reproject --force` une fois.

## En ligne de commande

- `openldr patients list [--search <texte>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <système> [--label <texte>] [--list-column on|off] [--searchable on|off]`

La sortie est masquée sauf avec `--identifiers`, qui est audité.
