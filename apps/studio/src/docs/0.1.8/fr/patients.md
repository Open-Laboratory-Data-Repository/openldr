# Patients

**Patients** liste chaque patient qu'OpenLDR a reçu avec des données de laboratoire, et où il a été testé. Le système source, comme un dossier hospitalier ou un système de laboratoire, est le propriétaire de chaque patient. OpenLDR affiche les patients et ne les modifie jamais.

Ce guide prend environ 15 minutes. Il utilise les données d'exemple de la documentation, chargez-les d'abord. Sélectionnez une image ou un clip pour l'agrandir.

![Patients avec les données d'exemple chargées : 25 patients.](patients-list.png)

## Qui peut faire quoi

Les noms des autorisations s'affichent en anglais.

| Autorisation | Ce qu'elle permet |
| --- | --- |
| View patient index | Ouvrir **Patients**. Les noms et les identifiants sont masqués, et la recherche ne trouve qu'un identifiant exact. |
| View patient identifiers | Voir en entier les noms, identifiants, date de naissance, téléphone et e-mail, et chercher par une partie du nom. Chaque affichage non masqué est audité. |
| Manage patient index | Nommer les systèmes d'identifiants, et choisir lesquels sont affichés et recherchés. Marquer des groupes de doublons. |

### Ce que le masquage cache

Sans **View patient identifiers** :

- Un nom montre sa première lettre, comme `J*** M***`.
- Un identifiant montre ses quatre derniers caractères.
- Vous voyez l'année de naissance, pas la date, et ni téléphone ni e-mail.
- La recherche ne trouve qu'un identifiant exact. Une recherche sur une partie du nom révélerait les noms lettre par lettre.

Avec elle, vous voyez tout, et la recherche trouve aussi une partie du nom. Chaque liste et chaque patient ouvert sont écrits dans le journal d'audit. Le journal note combien de patients correspondaient, jamais ce que vous avez cherché.

## Avant de commencer

Les exemples ont besoin des données d'exemple de la documentation. Si **Total Orders** affiche 0 sur le tableau de bord d'exemple, chargez-les d'abord. Voir [Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).

Avec l'exemple chargé, la liste montre 25 patients : les 24 patients d'exemple et un patient qu'une nouvelle installation crée elle-même, **Seed Sample**. Les âges sont calculés à partir de la date du jour, donc les vôtres peuvent différer d'un an des images.

## Exemple 1 : ouvrir un patient

![Sélectionner Chausiku Demo pour ouvrir la fiche du patient.](patients-sheet.mp4)

1. Ouvrez **Patients**.
2. Sélectionnez la ligne **Chausiku Demo**, 32 ans, avec 4 demandes.

![La fiche du patient : identité, identifiants et demandes.](patients-sheet-detail.png)

**Résultat attendu :** la fiche **Patient**. **Identité** montre le sexe M, la date de naissance 1994-05-14, et l'**Identifiant source** SAMPLE-0004. **Identifiants** liste `urn:openldr:sample:patient` SAMPLE-0004. **Demandes** liste quatre demandes, la plus récente en premier, avec le panel, l'établissement demandeur, le statut et le nombre de résultats. Un Full blood count est **revoked**, avec 0 résultat.

Vous pouvez aussi ouvrir un patient avec **Voir** dans le menu de sa ligne. Si un dossier a été fusionné dans un autre, le menu de la fiche propose **Ouvrir le patient dans lequel ce dossier a été fusionné**.

Si la fiche dit que la liste n'est plus à jour, le serveur a redémarré. Rechargez la page.

## Exemple 2 : nommer un identifiant et chercher avec

Chaque identifiant arrive avec un **système** : une URI qui dit de quel type d'identifiant il s'agit, comme un identifiant national ou un numéro ART. Les patients d'exemple utilisent `urn:openldr:sample:patient`. Par défaut, aucun système n'est affiché dans la liste, donc la colonne **Identifiants** est vide.

![Nommer le système d'exemple Sample ID, l'afficher dans la liste, et chercher SAMPLE-0007.](patients-identifier-system.mp4)

1. Ouvrez l'onglet **Systèmes d'identifiants**. Il liste chaque système vu, avec le nombre de patients qui le portent. Le système d'exemple en a 24.
2. Ouvrez le menu de la ligne `urn:openldr:sample:patient` et sélectionnez **Modifier**.
3. Dans **Libellé**, tapez `Sample ID`.
4. Activez **Afficher dans la liste**. Laissez **La recherche le trouve** activé.
5. Ouvrez le menu des actions de la fiche et sélectionnez **Enregistrer**.
6. Revenez à l'onglet **Patients**. Dans **Rechercher un nom ou un identifiant**, tapez `SAMPLE-0007`.

**Résultat attendu :** un seul patient, **Hamisi Sample**, F, avec `Sample ID: SAMPLE-0007` dans la colonne **Identifiants**.

![Recherche par l'identifiant d'exemple : un résultat.](patients-search.png)

- Laissez **Libellé** vide pour utiliser le nom envoyé par le système source.
- **Afficher dans la liste** ajoute le système à la colonne **Identifiants**.
- **La recherche le trouve** permet de trouver des patients par lui.
- Un laboratoire qui reçoit ces libellés du central ne peut pas les modifier.

Il faut **Manage patient index** pour modifier un système.

## Trouver un patient

Tapez n'importe quel identifiant, comme un numéro MPI ou un identifiant national, et OpenLDR trouve le patient quel que soit l'identifiant. **Filtrer** et **Statut** montrent aussi les dossiers fusionnés. **Colonnes** choisit ce que la liste affiche.

## Doublons

L'onglet **Doublons** liste les patients qui semblent être la même personne.

![L'onglet Doublons avec les données d'exemple : Aucun doublon probable.](patients-duplicates.png)

Avec les données d'exemple, il affiche **Aucun doublon probable.** OpenLDR en trouve de deux sortes :

- **Même identifiant.** Deux patients ou plus portent la même valeur dans le même système d'identifiants, comme le même NRC. Les identifiants sans système, et les systèmes où **La recherche le trouve** est désactivé, ne servent pas.
- **Même nom et même date de naissance.** Nom, prénom et date de naissance identiques, sans tenir compte de la casse, des espaces en trop ni des accents. Les patients de sexe différent ne sont pas rapprochés. Un patient sans date de naissance n'est jamais rapproché ainsi.

L'exemple a deux patients nommés Amina Demo. Ce n'est pas un groupe de doublons : leurs dates de naissance et leurs sexes diffèrent.

Seuls les patients actifs sont comparés. OpenLDR ne fusionne pas les patients. Corrigez les doublons dans le système source, et sa prochaine mise à jour efface le groupe ici.

- Sélectionnez un groupe pour voir ses patients. **Ouvrir le patient**, dans le menu d'un patient, ouvre le dossier complet.
- La liste montre au plus 50 patients par groupe, et dit combien elle en montre sur le total. Un groupe plus grand ne peut pas être marqué ici. Corrigez-le dans le système source, ou désactivez **La recherche le trouve** pour ce système d'identifiants. Un identifiant bouche-trou partagé par beaucoup de patients en est la cause habituelle.
- Avec **Manage patient index**, **Marquer comme pas des doublons**, dans le menu du groupe, note que ce sont des personnes différentes. Vous pouvez ajouter un motif. Utilisez **Statut** pour revoir ces groupes, et **Afficher à nouveau** pour annuler.
- Avec **View patient identifiers**, **Exporter en CSV**, dans le menu de l'onglet, envoie les groupes ouverts à l'équipe du système source. Chaque export est audité.

## Sur un téléphone

La liste des patients et la fiche marchent sur un téléphone.

![Patients sur un téléphone.](patients-phone.png)

## Après une mise à jour

Les patients reçus avant cette version n'ont aucun identifiant listé tant que vous n'avez pas lancé `openldr db reproject --force` une fois. Cela remplit aussi ce dont OpenLDR a besoin pour trouver les patients de même nom et même date de naissance.

## En ligne de commande

- `openldr patients list [--search <text>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off]`
- `openldr patients duplicates list [--status open|dismissed|all] [--limit <n>] [--offset <n>] [--identifiers]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <text>]` et `restore <idA> <idB>`
- `openldr patients duplicates export [--out <file>]`

La sortie est masquée sauf avec `--identifiers`. `patients list` et `patients show` avec `--identifiers` sont audités. De même `duplicates list` avec `--identifiers` et `duplicates export`, qui n'est jamais masqué. `duplicates dismiss` et `restore` sont audités aussi.

Par exemple, le même libellé que dans l'exemple 2 :

```bash
./openldr patients identifier-systems set urn:openldr:sample:patient --label "Sample ID" --list-column on
```

## Dépannage

- **Les noms s'affichent comme `J*** M***`.** Votre rôle n'a pas **View patient identifiers**.
- **La recherche ne trouve rien pour une partie du nom.** Sans **View patient identifiers**, la recherche ne trouve qu'un identifiant exact.
- **La colonne Identifiants est vide.** Aucun système d'identifiants n'a **Afficher dans la liste** activé. Voir [Exemple 2](#exemple-2-nommer-un-identifiant-et-chercher-avec).
- **La recherche ne trouve pas un patient par un identifiant.** Ce système a **La recherche le trouve** désactivé.
- **Un patient n'a pas d'identifiant après une mise à jour.** Lancez `openldr db reproject --force` une fois.
- **La fiche dit que la liste n'est plus à jour.** Rechargez la page.

## Guides associés

- [Établissements](/docs/facilities)
- [Catalogue des examens](/docs/test-catalog)
- [Exposition des données](/docs/data-exposure)
