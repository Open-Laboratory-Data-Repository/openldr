# Réception

La réception est le guichet du laboratoire. Quand un échantillon arrive, vous trouvez sa demande par le numéro de demande, vous enregistrez la demande si le laboratoire n'en a aucune trace, vous liez le patient et vous enregistrez l'échantillon avec son état. Vous pouvez aussi renvoyer une demande à son site, rejeter un échantillon ou une analyse, et lier le nouveau prélèvement. Le personnel d'accueil et les responsables de laboratoire l'utilisent.

Il faut **Receive samples** pour ouvrir **Réception**. Les rôles intégrés **Reception** et **Lab Manager** l'ont. Un utilisateur avec une limite de données ne peut pas ouvrir la réception, quel que soit son rôle.

Les noms des rôles et des capacités apparaissent en anglais à l'écran. Ce guide les écrit donc en anglais.

Le renvoi, le rejet et **Corrigée par le site** demandent aussi **Return and reject**. Les rôles **Reception** et **Lab Manager** ont les deux. **Lab Technician** a **Return and reject** mais pas **Receive samples**, il ne peut donc pas ouvrir la réception.

**Les listes de travail et la vérification des résultats ne font pas partie de cette version.** Elles arrivent dans des versions ultérieures.

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

## Renvoyer une demande à son site

Faites-le quand un bon de demande a une erreur que seul le site peut corriger, par exemple un formulaire incomplet. Il faut **Return and reject**.

1. Ouvrez le menu à points du panneau de la demande et sélectionnez **Renvoyer au site**.
2. Choisissez la raison dans **Motif**.
3. Saisissez une **Note** pour le site si elle aide.
4. Ouvrez le menu à points du panneau et sélectionnez **Renvoyer au site**.

**Résultat attendu :** un message indique, par exemple, `Demande CS-0001 renvoyée à son site.` Chaque analyse affiche **En attente**. Le panneau montre **Renvoyée au site** avec le motif, qui l'a renvoyée et quand.

**Renvoyer au site** n'apparaît pas pour une demande **Enregistrée à la réception**. Corrigez vous-même une demande de la réception. Il n'apparaît pas non plus pour une demande déjà renvoyée.

Tant qu'une demande est renvoyée, **Corriger la demande** n'est pas dans le menu. Le site fait les corrections.

Un site ne peut pas encore voir une demande renvoyée sur son propre écran. Prévenez le site par téléphone ou par message, avec le motif.

## Marquer une demande renvoyée comme corrigée

Faites-le quand le site renvoie ses corrections. **Corrigée par le site** n'apparaît que sur une demande renvoyée.

1. Ouvrez le menu à points du panneau de la demande et sélectionnez **Corrigée par le site**.
2. Modifiez **Priorité**, **Clinicien** ou **Note** selon ce que le site a envoyé. Laissez-les si le site a corrigé autre chose.
3. Saisissez la raison dans **Motif**, par exemple `Le site a envoyé le formulaire complet`.
4. Ouvrez le menu à points du panneau et sélectionnez **Marquer comme corrigée**.

**Résultat attendu :** un message indique, par exemple, `Demande CS-0001 marquée comme corrigée.` Les analyses ne sont plus en attente et affichent **Active**. **Corriger la demande** revient dans le menu.

## Rejeter un échantillon

Faites-le quand un échantillon ne peut pas être analysé, par exemple parce qu'il n'est pas étiqueté ou qu'il a coagulé. Il faut **Return and reject**.

1. Ouvrez le menu à points du panneau de la demande et sélectionnez **Rejeter l'échantillon**.
2. Choisissez **Type d'échantillon**. La liste contient les types d'échantillon que prennent les analyses de la demande.
3. Choisissez **État**.
4. Choisissez la raison dans **Motif**.
5. Laissez **Demander un nouveau prélèvement** activé pour demander un nouvel échantillon au site. Désactivez-le si aucun nouvel échantillon n'est nécessaire.
6. Ouvrez le menu à points du panneau et sélectionnez **Rejeter l'échantillon**.

**Résultat attendu :** un message indique, par exemple, `Échantillon rejeté pour la demande CS-0001.` Chaque analyse de cet échantillon affiche **Révoquée**, avec `Rejetée :` et le motif en dessous.

Rejeter un échantillon rejette toutes les analyses de cet échantillon. Pour rejeter une seule analyse, suivez la tâche suivante.

## Rejeter une seule analyse

Faites-le quand une analyse ne peut pas être faite, mais que les autres analyses de la demande peuvent continuer. Il faut **Return and reject**.

1. Ouvrez le menu à points à droite de la ligne de l'analyse et sélectionnez **Rejeter l'analyse**.
2. Vérifiez le nom de l'analyse à côté de **Analyse**.
3. Choisissez la raison dans **Motif**.
4. Laissez **Demander un nouveau prélèvement** activé, ou désactivez-le si aucun nouvel échantillon n'est nécessaire.
5. Ouvrez le menu à points du panneau et sélectionnez **Rejeter l'analyse**.

**Résultat attendu :** un message indique que l'analyse est rejetée. L'analyse affiche **Révoquée**, avec `Rejetée :` et le motif en dessous. Les autres analyses de la demande ne changent pas.

Sur une demande enregistrée avant cette version, plusieurs analyses peuvent partager une seule demande d'examen. Ces lignes n'ont pas de menu à points. Rejetez-les avec **Rejeter l'échantillon**.

## Lier un nouveau prélèvement à la demande rejetée

Faites-le quand le nouvel échantillon d'une demande rejetée arrive. Le nouveau prélèvement arrive sur son propre bon de demande, avec un nouveau numéro de demande. L'ancien numéro désigne toujours la demande rejetée.

1. Trouvez la demande du nouveau prélèvement par son nouveau numéro, ou enregistrez-la.
2. Ouvrez le menu à points du panneau de cette demande et sélectionnez **Remplace une demande rejetée**.
3. Saisissez l'ancien numéro dans **Numéro de la demande rejetée**.
4. Ouvrez le menu à points du panneau et sélectionnez **Lier le nouveau prélèvement**.

**Résultat attendu :** un message indique, par exemple, `Demande CS-0002 liée comme nouveau prélèvement de CS-0001.`

Les deux demandes doivent venir du même établissement. Le nouveau prélèvement doit contenir au moins une analyse que l'ancienne demande a rejetée. Cette tâche demande **Receive samples**.

Un site ne peut pas encore voir une demande de nouveau prélèvement sur son propre écran. Dites au site que le laboratoire a besoin d'un nouvel échantillon.

## Limites

- Les listes de travail et la vérification des résultats arrivent dans des versions ultérieures.
- Un site ne peut pas encore voir une demande renvoyée ou une demande de nouveau prélèvement sur son propre écran. Le laboratoire prévient le site.
- Le renvoi, le rejet et le lien d'un nouveau prélèvement ne sont pas encore des commandes `openldr`.
- Chaque analyse d'une nouvelle demande est sa propre demande d'examen. Une demande enregistrée avant cette version garde toutes ses analyses dans une seule demande d'examen, et la réception les liste toutes.
- Un utilisateur avec une limite de données perd **Receive samples** et **Return and reject**. La réception n'est donc pas dans son menu.

## Résolution des problèmes

- **Réception manque dans le menu principal.** Votre compte n'a pas **Receive samples**, ou il a une limite de données. Demandez à un administrateur. Lisez [Utilisateurs](/docs/users).
- **Une recherche ne trouve pas la demande attendue.** Vérifiez le numéro sur le bon. Une demande créée par un autre système apparaît une fois que les données de ce système sont arrivées dans OpenLDR. Si une demande que vous savez enregistrée n'apparaît toujours pas, un administrateur peut reconstruire la recherche avec `openldr lab requisitions rebuild --force`.
- **La recherche ne trouve aucun patient.** Vérifiez l'identifiant, ou saisissez le nom complet avec la date de naissance. Si le patient reste introuvable, enregistrez-le.
- **Enregistrer la correction indique `Rien n'a changé.`** Changez d'abord au moins un de **Priorité**, **Clinicien** ou **Note**.
- **Renvoyer au site, Rejeter l'échantillon ou Rejeter l'analyse manque.** Votre compte n'a pas **Return and reject**. Renvoyer au site manque aussi pour une demande de la réception et pour une demande déjà renvoyée.
- **Lier le nouveau prélèvement est refusé.** Vérifiez que vous avez saisi le numéro de la demande rejetée, pas celui du nouveau prélèvement. Vérifiez que les deux demandes viennent du même établissement, et que le nouveau prélèvement contient une analyse que l'ancienne demande a rejetée.
- **Un motif dont vous avez besoin n'est pas dans la liste.** Ajoutez-le dans **Terminologie**, à `urn:openldr:valueset:order-return-reason` pour les renvois, `urn:openldr:valueset:order-reject-reason` pour les échantillons, `urn:openldr:valueset:test-reject-reason` pour les analyses, ou `urn:openldr:valueset:sample-condition` pour les états. Lisez [Terminologie](/docs/terminology).

## Guides associés

- [Configuration du laboratoire](/docs/lab-setup)
- [Terminologie](/docs/terminology)
- [Formulaires](/docs/forms)
- [Rôles](/docs/roles)
- [Utilisateurs](/docs/users)
