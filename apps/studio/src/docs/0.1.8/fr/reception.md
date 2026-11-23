# Réception

La réception est le guichet du laboratoire. Quand un échantillon arrive, vous trouvez sa demande par le numéro de demande, vous enregistrez la demande si le laboratoire n'en a aucune trace, vous liez le patient et vous enregistrez l'échantillon avec son état. Le personnel d'accueil et les responsables de laboratoire l'utilisent.

Il faut **Receive samples** pour ouvrir **Réception**. Les rôles intégrés **Reception** et **Lab Manager** l'ont. Un utilisateur avec une limite de données ne peut pas ouvrir la réception, quel que soit son rôle.

Les noms des rôles et des capacités apparaissent en anglais à l'écran. Ce guide les écrit donc en anglais.

**Le renvoi d'une demande à son site, le rejet d'un échantillon, les listes de travail et la vérification des résultats ne font pas partie de cette version.** Ils arrivent dans des versions ultérieures.

## Trouver une demande

Le code-barres d'un bon de demande contient son numéro de demande. Un lecteur saisit le numéro dans la zone et appuie sur Entrée pour vous.

1. Sélectionnez **Réception** dans le menu principal.
2. Scannez le code-barres du bon, ou saisissez le numéro de demande dans la zone en haut et appuyez sur Entrée.

**Résultat attendu :** chaque demande avec ce numéro s'affiche dans un panneau. Le panneau montre le numéro, l'origine de la demande, **Établissement** et **Patient**. Il montre aussi **Priorité**, **Clinicien** et **Note** quand la demande les a. En dessous viennent les analyses de la demande, avec **Analyse**, **Code** et **Statut**, puis ses **Échantillons**.

Après une recherche, le numéro reste sélectionné dans la zone. Le scan suivant le remplace, vous n'avez donc jamais à vider la zone.

L'étiquette à côté du numéro dit d'où vient la demande : **Enregistrée à la réception**, **Formulaire de demande** ou **D'un autre système**.

Deux établissements peuvent utiliser le même numéro. Vous voyez alors un panneau pour chacun. Vérifiez **Établissement** avant de continuer.

Quand aucune demande n'a ce numéro, la page l'indique, par exemple `Aucune demande CS-0001 trouvée. Utilisez le menu pour l'enregistrer.`

## Enregistrer une demande introuvable

Faites-le quand le bon de demande est devant vous mais que le laboratoire n'a aucune trace de la demande.

1. Recherchez le numéro, comme dans la tâche ci-dessus.
2. Ouvrez le menu à points à droite de la zone et sélectionnez **Enregistrer cette demande**.
3. Vérifiez le numéro dans **Numéro de demande**. Il est rempli à partir de votre recherche.
4. Dans **Établissement**, saisissez deux lettres du nom ou du code, puis choisissez l'établissement dans la liste.
5. Dans **Analyses**, saisissez une partie du nom d'une analyse et cochez chaque analyse demandée.
6. Ouvrez le menu à points du panneau et sélectionnez **Trouver ou enregistrer le patient**. Suivez ensuite la tâche suivante.
7. Choisissez **Priorité**, et saisissez **Clinicien** et **Note** si le bon les donne.
8. Ouvrez le menu à points du panneau et sélectionnez **Enregistrer la demande**.

**Résultat attendu :** un message indique, par exemple, `Demande CS-0001 enregistrée.` La demande s'affiche dans un panneau marqué **Enregistrée à la réception**.

L'établissement, le numéro et les analyses ne peuvent plus changer après l'enregistrement. Vérifiez-les avant l'étape 8.

Une demande a besoin d'un numéro, d'un établissement, d'au moins une analyse et d'un patient. S'il en manque un, rien n'est enregistré.

**Enregistrer cette demande** reste dans le menu après toute recherche, même si une demande a été trouvée, car un autre établissement peut utiliser le même numéro. Le même numéro du même établissement ne peut pas être enregistré deux fois.

## Trouver le patient

Le panneau **Patient** s'ouvre depuis **Trouver ou enregistrer le patient** dans le panneau d'enregistrement, ou depuis **Lier un patient** dans le menu à points d'une demande.

1. Saisissez l'identifiant du patient dans **Identifiant**. Ou saisissez le prénom et le nom de famille dans **Nom complet** et choisissez la **Date de naissance**.
2. Ouvrez le menu à points à côté de **Trouver** et sélectionnez **Rechercher**.
3. Sélectionnez le patient dans la liste.
4. Ouvrez le même menu à points et sélectionnez **Utiliser ce patient**.

**Résultat attendu :** le panneau se ferme. Le nom du patient s'affiche à côté de **Patient**.

Une recherche ne montre un patient que pour un identifiant exact, ou un nom complet avec la date de naissance complète. Une partie du nom, ou un nom sans date de naissance, ne trouve personne. Vous pouvez ainsi confirmer un patient que vous connaissez déjà sans parcourir la liste des patients.

Une recherche par identifiant utilise les systèmes d'identifiant que votre laboratoire a rendus consultables.

## Enregistrer un nouveau patient

Faites-le quand la recherche indique `Aucun patient ne correspond. Enregistrez-le ci-dessous.`

1. Sous **Nouveau patient**, saisissez **Prénom** et **Nom de famille**.
2. Choisissez **Sexe**.
3. Choisissez **Date de naissance**. Si personne ne la connaît, saisissez plutôt l'âge dans **Âge en années**. Si vous remplissez les deux, la date de naissance est utilisée.
4. Si le patient a un identifiant, saisissez **Système d'identifiant** et **Valeur de l'identifiant**.
5. Ouvrez le menu à points à côté de **Trouver** et sélectionnez **Enregistrer le patient**.

**Résultat attendu :** un message indique que le patient est enregistré. Le panneau se ferme, et le nouveau patient est utilisé pour la demande.

Avec un âge au lieu d'une date de naissance, OpenLDR estime la date de naissance au 1er janvier de l'année que donne l'âge. Le dossier du patient indique que la date de naissance est une estimation.

Un identifiant a besoin de son système et de sa valeur. Laissez les deux vides quand le patient n'en a pas.

## Lier le patient à une demande trouvée

Faites-le quand une demande affiche **Aucun patient lié**, ou le mauvais patient.

1. Ouvrez le menu à points du panneau de la demande et sélectionnez **Lier un patient**.
2. Trouvez le patient, ou enregistrez-en un nouveau, comme dans les deux tâches ci-dessus.
3. Ouvrez le menu à points à côté de **Trouver** et sélectionnez **Utiliser ce patient**, ou **Enregistrer le patient** pour un nouveau.

**Résultat attendu :** un message indique que le patient est lié à la demande. Le panneau montre le nom du patient.

Le lien est gardé comme une correction, avec votre nom et le motif `Patient lié à la réception`. Les échantillons déjà reçus pour la demande passent aussi au nouveau patient.

## Recevoir l'échantillon

1. Ouvrez le menu à points du panneau de la demande et sélectionnez **Recevoir un échantillon**.
2. Choisissez **Type d'échantillon**. La liste contient les types d'échantillon que prennent les analyses de la demande, d'après le catalogue des examens.
3. Choisissez **État**, ou laissez **Non renseigné**.
4. Sous **Pour les analyses**, gardez cochées les analyses pour lesquelles sert cet échantillon.
5. Ouvrez le menu à points du panneau et sélectionnez **Recevoir l'échantillon**.

**Résultat attendu :** un message indique, par exemple, `Échantillon reçu pour la demande CS-0001.` L'échantillon s'affiche sous **Échantillons**, avec son état et l'heure de réception.

Une demande garde un échantillon de chaque type. Recevoir de nouveau le même type met cet échantillon à jour et garde l'heure de la première réception.

La liste des états vient du jeu de valeurs des états d'échantillon de votre laboratoire. Si le panneau indique `Les analyses de cette demande ne nomment aucun type d'échantillon. Associez ces analyses à un type d'échantillon dans le catalogue des examens.`, ajoutez les types d'échantillon à ces analyses dans le catalogue des examens.

## Corriger une faute de frappe dans une demande

Une correction peut changer la priorité, le clinicien et la note. Pour changer le patient, utilisez **Lier un patient**.

1. Ouvrez le menu à points du panneau de la demande et sélectionnez **Corriger la demande**.
2. Modifiez **Priorité**, **Clinicien** ou **Note**.
3. Saisissez la raison dans **Motif**, par exemple `Nom du clinicien mal orthographié`.
4. Ouvrez le menu à points du panneau et sélectionnez **Enregistrer la correction**.

**Résultat attendu :** un message indique, par exemple, `Demande CS-0001 corrigée.` Le panneau montre les nouvelles valeurs.

Chaque correction est gardée avec votre nom et le motif, et elle est enregistrée dans **Audit**.

Un mauvais numéro de demande, établissement ou liste d'analyses ne peut pas être corrigé. Pour une demande **Enregistrée à la réception**, annulez l'enregistrement et enregistrez de nouveau la demande, comme dans la tâche suivante. Pour une demande du **Formulaire de demande**, une personne qui peut marquer des saisies comme erronées marque la saisie dans l'onglet **Saisies** du formulaire, puis vous enregistrez de nouveau la demande. Lisez [Formulaires](/docs/forms).

## Annuler un enregistrement fait à la réception

Faites-le quand une demande enregistrée à la réception a un mauvais numéro, établissement ou liste d'analyses. **Annuler l'enregistrement** n'apparaît que pour une demande marquée **Enregistrée à la réception**.

1. Ouvrez le menu à points du panneau de la demande et sélectionnez **Annuler l'enregistrement**.
2. Saisissez la raison dans **Motif**, par exemple `Mauvaise liste d'analyses`.
3. Ouvrez le menu à points du panneau et sélectionnez **Annuler l'enregistrement**.

**Résultat attendu :** un message indique, par exemple, `Demande CS-0001 annulée.` Chaque analyse de la demande affiche le statut **Saisie par erreur**.

Chaque analyse annulée est gardée avec votre nom et le motif, et l'annulation est enregistrée dans **Audit**. Une demande annulée ne prend aucun échantillon.

Pour enregistrer de nouveau la demande avec les bons détails, recherchez le numéro et suivez [Enregistrer une demande introuvable](#enregistrer-une-demande-introuvable). Les nouvelles analyses s'affichent dans le même panneau. Les analyses annulées restent listées comme **Saisie par erreur**.

## Limites

- Le renvoi d'une demande à son site, le rejet d'un échantillon, les listes de travail et la vérification des résultats arrivent dans des versions ultérieures.
- Chaque analyse d'une nouvelle demande est sa propre demande d'examen. Une demande enregistrée avant cette version garde toutes ses analyses dans une seule demande d'examen, et la réception les liste toutes.
- Un utilisateur avec une limite de données perd **Receive samples** et **Return and reject**. La réception n'est donc pas dans son menu.

## Résolution des problèmes

- **Réception manque dans le menu principal.** Votre compte n'a pas **Receive samples**, ou il a une limite de données. Demandez à un administrateur. Lisez [Utilisateurs](/docs/users).
- **Une recherche ne trouve pas la demande attendue.** Vérifiez le numéro sur le bon. Une demande créée par un autre système apparaît une fois que les données de ce système sont arrivées dans OpenLDR. Si une demande que vous savez enregistrée n'apparaît toujours pas, un administrateur peut reconstruire la recherche avec `openldr lab requisitions rebuild --force`.
- **La recherche ne trouve aucun patient.** Vérifiez l'identifiant, ou saisissez le nom complet avec la date de naissance. Si le patient reste introuvable, enregistrez-le.
- **Enregistrer la correction indique `Rien n'a changé.`** Changez d'abord au moins un de **Priorité**, **Clinicien** ou **Note**.

## Guides associés

- [Configuration du laboratoire](/docs/lab-setup)
- [Formulaires](/docs/forms)
- [Rôles](/docs/roles)
- [Utilisateurs](/docs/users)
