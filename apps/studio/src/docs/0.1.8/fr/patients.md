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

## Doublons

L'onglet **Doublons** liste les patients qui semblent être la même personne. CE en trouve deux sortes :

- **Même identifiant.** Deux patients ou plus portent la même valeur dans le même système d'identifiants, par exemple le même NRC. Les identifiants sans système, et les systèmes où **La recherche le trouve** est désactivé, ne sont pas utilisés.
- **Même nom et même date de naissance.** Le nom, le prénom et la date de naissance correspondent, sans tenir compte des majuscules, des espaces en trop ni des accents. Les patients de sexes différents ne sont pas rapprochés. Un patient sans date de naissance n'est jamais rapproché de cette façon.

Seuls les patients actifs sont comparés. CE ne fusionne pas les patients : corrigez les doublons dans le système source, et la mise à jour suivante fait disparaître le groupe ici.

Cliquez sur un groupe pour voir ses patients. Choisissez **Ouvrir le patient** dans le menu ⋯ d'un patient pour voir le dossier complet.

Un groupe peut être grand. La liste montre au plus 50 patients par groupe, et la fiche indique combien elle en montre sur le total. Un groupe qui compte plus de patients ne peut pas être marqué ici comme pas des doublons. Corrigez-le dans le système source, ou désactivez **La recherche le trouve** pour ce système d'identifiants. La cause habituelle est un identifiant factice partagé par de nombreux patients.

Avec l'autorisation Gérer l'index des patients, choisissez **Marquer comme pas des doublons** dans le menu ⋯ du groupe quand les patients sont des personnes différentes. Vous pouvez ajouter un motif. Utilisez **Statut** pour revoir ces groupes, et **Afficher à nouveau** pour annuler.

Avec l'autorisation Voir les identifiants des patients, choisissez **Exporter en CSV** dans le menu ⋯ de l'onglet pour envoyer les groupes ouverts à l'équipe du système source. Chaque export est inscrit au journal d'audit.

## Après la mise à jour

Les patients reçus avant cette version n'ont aucun identifiant listé tant que vous n'avez pas lancé `openldr db reproject --force` une fois. Elle remplit aussi ce dont CE a besoin pour trouver les patients ayant le même nom et la même date de naissance.

## En ligne de commande

- `openldr patients list [--search <texte>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <système> [--label <texte>] [--list-column on|off] [--searchable on|off]`
- `openldr patients duplicates list [--status open|dismissed|all] [--identifiers]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <texte>]` et `restore <idA> <idB>`
- `openldr patients duplicates export [--out <fichier>]`

La sortie est masquée sauf avec `--identifiers`, qui est audité.
