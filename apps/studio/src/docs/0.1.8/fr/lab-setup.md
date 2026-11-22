# Configuration du laboratoire

La configuration du laboratoire prépare ce laboratoire au module laboratoire. Vous ajoutez les sections du laboratoire, choisissez les examens à vérifier, décidez si une personne peut valider ses propres résultats et fixez des seuils critiques sur les intervalles de référence. Les responsables de laboratoire et les administrateurs le font une fois, avant que le laboratoire commence le travail.

**La réception, les listes de travail et la vérification des résultats ne font pas partie de cette version.** Elles arrivent dans des versions ultérieures. Cette version enregistre les réglages qu'elles utiliseront. Les enregistrer ne change rien au travail actuel du laboratoire.

Il faut **Lab settings** pour modifier les sections, l'interrupteur de vérification et l'auto-validation. Les seuils critiques font partie des intervalles de référence d'un examen. Ils exigent donc **Manage terminology**, comme le reste de la définition de l'examen. Ouvrir **Catalogue des examens** exige **Browse terminology**.

Les noms des rôles et des capacités apparaissent en anglais à l'écran. Ce guide les écrit donc en anglais.

Suivez les tâches dans l'ordre ci-dessous. Un examen ne peut être classé que dans une section qui existe.

## Ajouter les sections du laboratoire

Une section est une partie du laboratoire, comme l'hématologie ou la microbiologie. Les listes de travail filtreront par section. Un laboratoire sans sections peut passer cette tâche.

1. Ouvrez votre menu utilisateur en bas à gauche et sélectionnez **Paramètres**.
2. Sélectionnez **Laboratoire**.
3. Ouvrez le menu à points en haut à droite et sélectionnez **Ajouter une section**.
4. Saisissez le code dans **Code**, par exemple `haem`. Utilisez des lettres minuscules, des chiffres et des tirets, en commençant par une lettre.
5. Saisissez le nom dans **Nom**, par exemple `Hématologie`.
6. Ouvrez le menu à points du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** un message indique **Section haem ajoutée.** La section figure dans le tableau **Sections**. Elle apparaît tout de suite dans le catalogue des examens.

Le code ne peut plus changer après l'enregistrement. Pour changer un code, supprimez la section et ajoutez-la de nouveau.

## Supprimer une section

1. Ouvrez **Paramètres**, puis **Laboratoire**.
2. Trouvez la section dans le tableau **Sections**.
3. Ouvrez le menu à points de sa ligne et sélectionnez **Supprimer**.
4. Lisez la demande de confirmation et sélectionnez **Supprimer**.

**Résultat attendu :** un message indique que la section est supprimée, et elle quitte le tableau. Cette action est définitive.

OpenLDR refuse de supprimer une section encore utilisée par un examen. Déplacez d'abord ces examens vers une autre section, ou vers **Aucune section**.

## Choisir les examens à vérifier et leur section

Chaque examen a sa propre section et son propre réglage de vérification dans ce laboratoire. Un nouvel examen exige une vérification tant que vous ne la désactivez pas.

1. Ouvrez **Catalogue des examens** et sélectionnez l'onglet **Tests**.
2. Ouvrez le menu à points de la ligne de l'examen et sélectionnez **Modifier**.
3. Sous **Ce laboratoire**, choisissez la section dans **Section**, ou choisissez **Aucune section**.
4. Activez ou désactivez **Vérification requise**.
5. Ouvrez le menu à points du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** un message indique que l'examen est enregistré. La section et l'interrupteur gardent votre choix quand vous rouvrez l'examen.

La vérification des résultats arrive dans une version ultérieure. Avec elle, quand **Vérification requise** est activé, une seconde étape validera chaque résultat avant sa diffusion. Quand il est désactivé, un résultat sans valeur critique sera diffusé sans cette étape. Une valeur critique passera toujours en vérification.

**Section** est masqué tant que le laboratoire n'a aucune section. Sans **Lab settings**, vous pouvez lire les deux champs, mais pas les modifier.

## Décider de l'auto-validation

Par défaut, la personne qui a saisi un résultat ne peut pas le valider. Activez ce réglage seulement si votre laboratoire permet à une personne de faire les deux, par exemple un laboratoire avec un seul technicien de nuit.

1. Ouvrez **Paramètres**, puis **Laboratoire**.
2. Trouvez **Autoriser une personne à valider les résultats qu'elle a saisis**.
3. Activez ou désactivez l'interrupteur.

**Résultat attendu :** un message indique **Enregistré.** L'interrupteur s'enregistre dès que vous le changez. Il n'y a pas d'étape d'enregistrement à part.

## Ajouter des seuils critiques à un intervalle de référence

Un seuil critique est une valeur si loin de l'intervalle qu'il faut agir tout de suite. La saisie des résultats signalera une valeur qui le dépasse. Utilisez les seuils approuvés par votre laboratoire. Ne copiez pas les nombres d'un exemple.

1. Ouvrez **Catalogue des examens** et ouvrez l'examen avec **Modifier**.
2. Trouvez le champ de résultat et son intervalle de référence.
3. Saisissez le seuil inférieur dans **Seuil critique bas**.
4. Saisissez le seuil supérieur dans **Seuil critique haut**.
5. Ouvrez le menu à points du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** un message indique que l'examen est enregistré. Les seuils sont gardés avec l'intervalle.

Vous pouvez remplir un seuil, les deux ou aucun. OpenLDR vérifie trois règles à l'enregistrement :

- **Seuil critique bas** doit être inférieur ou égal à **Borne basse**.
- **Seuil critique haut** doit être supérieur ou égal à **Borne haute**.
- **Seuil critique bas** doit être inférieur à **Seuil critique haut**.

Une règle n'est vérifiée que si l'intervalle a ses deux valeurs. Un refus nomme le champ de résultat et l'intervalle. Le message vient du serveur, en anglais, par exemple `HGB range 1: the critical low limit must be at or below the low limit.`

## Donner les rôles du laboratoire

Trois rôles intégrés couvrent le travail du laboratoire.

- **Reception** peut réceptionner les échantillons, renvoyer une demande à son site, rejeter un échantillon, voir les listes de travail et ouvrir l'index des patients masqué.
- **Lab Technician** peut remplir et soumettre des formulaires, saisir des résultats et voir les listes de travail.
- **Lab Manager** détient toutes les capacités du laboratoire, **Lab settings** compris.

La page **Rôles** liste les sept capacités du laboratoire dans le groupe **Lab** : **Receive samples**, **Return and reject**, **Enter results**, **Authorise results**, **Amend results**, **View worklists** et **Lab settings**.

Il faut **Manage roles** pour donner un rôle à une personne.

1. Ouvrez **Utilisateurs**.
2. Trouvez le compte, ouvrez le menu à points de sa ligne et sélectionnez **Modifier**. Sans administration d'identité disponible, le menu affiche **Modifier le rôle**.
3. Ouvrez **Rôle** et sélectionnez **Reception**, **Lab Technician** ou **Lab Manager**.
4. Ouvrez le menu à points du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** le panneau se ferme. Rouvrez le compte pour vérifier le rôle enregistré.

Sur une installation qui utilisait une version antérieure, **Reception** apparaît au premier démarrage du serveur sur cette version. **Lab Technician** et **Lab Manager** reçoivent leurs nouvelles capacités au même démarrage, une seule fois. Si vous retirez ensuite une capacité à l'un d'eux, elle reste retirée.

La plupart de ces capacités ouvrent des écrans qui arrivent dans des versions ultérieures. Aujourd'hui, seule **Lab settings** change ce qu'une personne peut faire.

## Configurer le laboratoire en ligne de commande

Chaque tâche ci-dessus, sauf les seuils critiques et les rôles, existe aussi comme commande `openldr`. Chaque commande passe par le serveur OpenLDR en marche, en tant que personne qui détient **Lab settings**. Sous Linux et macOS, connectez-vous d'abord avec `./openldr login`, ou définissez une clé d'accès dans `OPENLDR_KEY`. Sous Windows, définissez d'abord une clé d'accès dans `OPENLDR_KEY`. Le CLI s'y connecte uniquement avec une clé d'accès. Lisez [Utilisateurs](/docs/users) pour créer une clé d'accès. Lisez [Commencer ici](/docs/start-here) pour la CLI installée et celle de développement.

Exemple dans une copie de développement :

```shell
pnpm openldr lab sections add haem Hématologie
pnpm openldr lab sections list
pnpm openldr lab tests set HGB --section haem --needs-review true
pnpm openldr lab tests set HGB --no-section
pnpm openldr lab settings set allow-self-authorise false
pnpm openldr lab sections remove haem --force
```

Pour une copie installée sous Linux ou macOS, utilisez `./openldr` au lieu de `pnpm openldr`. Sous Windows, utilisez `.\openldr.ps1` depuis votre dossier d'installation, avec `OPENLDR_KEY` défini. Ces commandes n'ont pas été lancées sous Windows.

`lab sections remove` refuse sans `--force`, car une suppression est définitive. Chaque commande est inscrite dans le journal d'audit sous votre compte.

## Limites

- La réception, les listes de travail et la vérification des résultats ne font pas partie de cette version. Ces réglages prennent effet à leur arrivée.
- Une section a un code et un nom. Le code ne peut pas changer.
- La section et le réglage de vérification appartiennent à ce laboratoire. Un catalogue partagé par le central ne les définit pas.

## Résolution des problèmes

- **Ajouter une section manque dans le menu à points.** Votre compte n'a pas **Lab settings**.
- **Section manque dans le panneau de l'examen.** Le laboratoire n'a encore aucune section. Ajoutez-en une sur **Laboratoire**.
- **Une section n'est pas supprimée.** Un examen l'utilise encore. Le message indique combien. Déplacez d'abord ces examens.
- **L'enregistrement refuse un seuil critique.** Lisez le message. Il nomme l'intervalle et la règle non respectée.

## Guides associés

- [Laboratoire](/docs/laboratory)
- [Catalogue des examens](/docs/test-catalog)
- [Rôles](/docs/roles)
- [Utilisateurs](/docs/users)
