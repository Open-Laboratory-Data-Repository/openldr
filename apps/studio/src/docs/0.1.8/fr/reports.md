# Rapports

Un rapport est une page imprimable de chiffres du laboratoire, que vous pouvez relancer quand vous en avez besoin. Chacun réunit deux parties. Un modèle du **Concepteur de rapports** fixe la mise en page. Une **requête personnalisée** va chercher les données. Vous lancez un rapport avec une période et d'autres filtres, vous le lisez comme document ou comme tableur, vous le téléchargez, et vous le planifiez pour qu'il s'exécute seul.

Ce guide prend environ 30 minutes. Il utilise les données d'exemple de la documentation, chargez-les d'abord. Sélectionnez une image ou un clip pour l'agrandir. Les noms des rapports et de leurs filtres sont en anglais, car ils viennent des modèles.

![Un rapport après exécution. 1 Recherche dans la bibliothèque. 2 Menu des actions du rapport. 3 Vue Document. 4 Vue Tableur. 5 Télécharger.](reports-tour.png)

1. **Recherche.** Filtre la liste des rapports par nom. Les rapports sont regroupés par catégorie.
2. **Actions.** Le menu à trois points du rapport choisi : **Actualiser**, **Paramètres**, **Historique**, **Planifications** et, pour les responsables, **Modifier le modèle**, **Dépublier** et **Supprimer le rapport**.
3. **Document.** Le PDF imprimable.
4. **Tableur.** Les mêmes lignes dans un tableau que vous pouvez filtrer, trier et exporter.
5. **Télécharger.** Enregistre le PDF.

## Qui peut faire quoi

Les noms des autorisations s'affichent en anglais.

| Autorisation | Ce qu'elle permet |
| --- | --- |
| View reports | Ouvrir **Rapports** et voir la bibliothèque. |
| Run reports | Exécuter un rapport et voir son résultat. |
| Export reports | Télécharger le PDF, le CSV ou le XLSX, et les fichiers enregistrés des planifications. |
| Edit report templates | Créer, modifier et supprimer des planifications. Utiliser **Modifier le modèle**, **Dépublier** et **Supprimer le rapport**. |

Les nouveaux rapports ne se créent pas sur cette page. Un responsable de laboratoire construit un modèle dans le [Concepteur de rapports](/docs/report-designer) et le publie. Il apparaît alors dans la bibliothèque.

## Avant de commencer

Les exemples ont besoin des données d'exemple de la documentation. Si **Total Orders** affiche 0 sur le tableau de bord d'exemple, chargez-les d'abord. Voir [Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).

Une nouvelle installation fournit dix rapports dans quatre catégories :

| Catégorie | Rapports | Fonctionne avec l'exemple |
| --- | --- | --- |
| AMR / Surveillance | AMR Cumulative Antibiogram, AMR First-Isolate Resistance Summary, AMR Resistance Rate, AMR Resistance by Facility | Non. Ils ont besoin de résultats de microbiologie. |
| Operational | Clinical Microbiology Report, LIS Stakeholders Update, Specimen Turnaround Time, Test Volume Over Time | Turnaround et Test Volume, oui |
| Quality | Patient Demographics | Oui |
| Regulatory | AMR GLASS RIS (stratified) | Non. Il a besoin de résultats de microbiologie. |

Les rapports AMR et de microbiologie lisent des germes et des résultats d'antibiogramme. L'exemple n'en contient pas, donc ils restent vides. Ils se remplissent quand votre système de laboratoire envoie de la microbiologie, par exemple par un export WHONET. Voir [Load and push data](https://openldr.online/#/docs/load-data) sur le site web.

## Exemple 1 : exécuter un rapport

Comptez les examens demandés chaque mois en septembre et octobre 2026.

![Choisir Test Volume Over Time, régler la période et l'exécuter.](reports-run.mp4)

1. Ouvrez **Rapports**.
2. Dans la bibliothèque, sous **Operational**, sélectionnez **Test Volume Over Time**. La page affiche **Exécutez le rapport pour voir les résultats.**
3. Ouvrez le menu à trois points et sélectionnez **Paramètres**. Un panneau latéral liste les filtres du rapport. Une étoile marque un filtre obligatoire.
4. Sélectionnez **Date range**. Revenez à septembre 2026. Sélectionnez le 1er septembre, puis le 31 octobre.
5. Laissez **Facility** sur **Tous**.
6. Sélectionnez **Exécuter**. Le panneau se ferme et le rapport s'exécute.

**Résultat attendu :** **Total tests** affiche 60. Le document a dix lignes, une par examen et par mois. En octobre : Blood glucose 3, Creatinine 5, Full blood count 8, HIV viral load 8, Malaria rapid test 8.

Les filtres viennent des paramètres du modèle. Pour en ajouter, en retirer ou en renommer un, modifiez le modèle dans le [Concepteur de rapports](/docs/report-designer), pas cette page. Un rapport se souvient des dernières valeurs utilisées, dans ce navigateur.

## Lire le résultat

La vue document a des flèches de page, un zoom et **Télécharger**. **Télécharger** enregistre le PDF et ajoute une exécution `pdf` à l'historique.

Sélectionnez **Tableur** pour voir les mêmes lignes dans un tableau.

![La vue Tableur, avec Filtrer, Trier, Colonnes et les deux exports.](reports-spreadsheet.png)

- **Filtrer.** Choisissez une colonne, un opérateur et une valeur, puis **Appliquer**. Retirez une pastille de filtre pour effacer une règle, ou utilisez **Tout effacer**.
- **Trier.** Change l'ordre.
- **Colonnes.** Masque et affiche des colonnes.
- **Exporter CSV** et **Exporter XLSX.** Téléchargent les lignes pour d'autres outils.

Utilisez le tableur quand vous avez besoin des valeurs exactes, ou pour envoyer les lignes vers un autre outil.

### Ce que veut dire « Facility » dans les rapports fournis

Le filtre **Facility** et les colonnes d'établissement des rapports fournis désignent le **laboratoire qui a fait l'analyse**. Ils ne regroupent pas par la clinique qui a envoyé l'échantillon. Sur une nouvelle installation, la liste est vide tant qu'aucun registre d'établissements n'est chargé. Voir [Établissements](/docs/facilities).

## Historique

Ouvrez le menu à trois points et sélectionnez **Historique**.

![L'historique. Activité liste chaque exécution, avec son format, ses lignes, son utilisateur et son heure.](reports-history.png)

- **Activité** liste les exécutions faites à la main. `preview` est une exécution sur cette page. `pdf`, `csv` et `xlsx` sont des téléchargements.
- **Exécutions planifiées** liste les tentatives des planifications, leur statut et le fichier enregistré. **Télécharger**, à côté d'une exécution réussie, récupère son CSV, XLSX ou PDF.

Servez-vous de l'historique pour comparer des exécutions, et pour voir si un résultat a changé après l'arrivée de nouvelles données. Pour savoir qui a modifié les réglages ou les planifications, voir [Audit](/docs/audit).

## Exemple 2 : délai de traitement des échantillons

Voyez combien de temps chaque examen prend, de l'échantillon reçu au compte rendu émis.

![Specimen Turnaround Time pour septembre et octobre 2026.](reports-turnaround.png)

1. Dans la bibliothèque, sélectionnez **Specimen Turnaround Time**.
2. Ouvrez le menu à trois points, puis **Paramètres**. Réglez **Date range** du 1er septembre au 31 octobre 2026.
3. Sélectionnez **Exécuter**.

**Résultat attendu :** **Reports** affiche 39 et **Avg hours** affiche 19.0. Creatinine fait en moyenne 15.0 heures, Malaria rapid test 17.1, Full blood count 20.5, Blood glucose 20.7 et HIV viral load 21.9.

Chaque compte rendu est compté depuis son propre échantillon : de la réception de cet échantillon à l'émission du compte rendu. Un compte rendu sans échantillon lié est laissé de côté.

## Exemple 3 : planifier un rapport

Faites tourner Test Volume chaque lundi et enregistrez un PDF.

![Ouvrir Planifications, créer une planification hebdomadaire en PDF et l'enregistrer.](reports-schedule.mp4)

1. Sélectionnez **Test Volume Over Time**. Ouvrez le menu à trois points et sélectionnez **Planifications**. Votre rôle doit avoir **Edit report templates**.
2. Sélectionnez **Nouvelle planification**.
3. Réglez **Fréquence** sur **Hebdomadaire**. Réglez **Jour de la semaine** sur **Mon**. Les jours s'affichent en anglais.
4. Réglez **Format de sortie** sur **PDF**. Laissez **Facility** sur **Tous**.
5. Ouvrez le menu à trois points de la planification et sélectionnez **Enregistrer**. Le message **Planification enregistrée.** apparaît.

**Résultat attendu :** la liste montre la planification hebdomadaire du lundi, un badge **PDF**, un interrupteur activé et la **Prochaine** exécution.

![La planification enregistrée, avec son interrupteur, Exécuter, Modifier et Supprimer.](reports-schedules.png)

Chaque ligne de planification a un interrupteur pour l'activer ou la désactiver, un bouton lecture, **Exécuter**, un crayon pour **Modifier** et une corbeille pour **Supprimer**.

### Fréquence, heure et période

- **Quotidien**, **Hebdomadaire**, **Mensuel** ou **Trimestriel**. Hebdomadaire demande un jour de la semaine. Mensuel propose les jours 1 à 28.
- Chaque planification s'exécute à 06:00 UTC. Vous ne pouvez pas choisir une autre heure ni un autre fuseau.
- **Prochaine** et **Dernière** s'affichent dans le fuseau horaire de votre navigateur.
- Le filtre **Time zone** d'un rapport règle le calcul des données, pas l'heure de la planification.
- Une nouvelle planification reprend les filtres actuels de la page, sauf la période.

La période n'est pas enregistrée. Le planificateur la calcule au début de l'exécution, y compris avec **Exécuter** :

| Fréquence | Prochaine date à l'enregistrement | Période |
| --- | --- | --- |
| Quotidien | Demain | Le jour UTC précédent |
| Hebdomadaire | Le prochain jour choisi, jamais aujourd'hui | Les sept jours UTC précédents, jusqu'à hier |
| Mensuel | Le jour choisi le mois suivant | Le mois civil précédent en UTC |
| Trimestriel | Le premier jour du trimestre suivant | Le trimestre civil précédent en UTC |

Une planification désactivée peut encore montrer **Prochaine**. Cette date ne veut pas dire qu'elle s'exécutera. Vérifiez l'interrupteur. **Dernière** peut être une tentative échouée. Vérifiez son statut dans l'historique.

### Exécuter maintenant et télécharger le fichier

1. Activez la planification, puis sélectionnez **Exécuter**, le bouton lecture.
2. Un message dit que l'exécution est lancée. Cela ne veut pas dire qu'elle a réussi. Une planification désactivée affiche le même message et ne fait rien.
3. Ouvrez le menu à trois points, **Historique**, **Exécutions planifiées**. Les exécutions automatiques et celles lancées à la main y apparaissent quand elles sont finies.
4. Sélectionnez **Télécharger** à côté d'une exécution réussie. Il vous faut **Export reports**.
5. Si l'exécution n'apparaît pas, fermez et rouvrez **Exécutions planifiées**. La liste ne s'actualise pas seule.

Une exécution échouée n'a pas de fichier. Sur un ordinateur, pointez son statut **Échec** pour lire l'erreur. Corrigez les filtres de la planification et relancez. Une exécution planifiée ne remplace jamais ce qu'affiche la page du rapport.

## Gérer un rapport

Avec **Edit report templates**, le menu à trois points du rapport propose aussi :

- **Modifier le modèle.** Ouvre le modèle dans le [Concepteur de rapports](/docs/report-designer).
- **Dépublier.** Retire le rapport de la bibliothèque et garde le modèle.
- **Supprimer le rapport.** Le supprime, après confirmation.

## Sur un téléphone

Sur un téléphone, la bibliothèque commence repliée en une fine bande à gauche. Sélectionnez le bouton de panneau en haut de la bande pour l'ouvrir. Les noms longs sont coupés dans la liste. Le nom complet s'affiche quand vous choisissez le rapport. Repliez de nouveau la bibliothèque pour donner tout l'écran au rapport.

![La bibliothèque des rapports ouverte sur un téléphone.](reports-phone.png)

## Limites

Chaque requête de rapport enregistrée renvoie au plus 1 000 lignes. Exactement 1 000 est accepté. Si une requête derrière un PDF dépasse, tout le PDF est refusé. Les exports CSV et XLSX refusent aussi. Restreignez la période ou les autres filtres et relancez. Un `LIMIT` écrit dans le SQL enregistré est conservé exprès.

Une exécution planifiée qui dépasse enregistre un échec et ne sauvegarde aucun fichier. La ligne de commande signale l'erreur avant d'écrire l'export. Les fichiers déjà enregistrés ne sont pas recalculés.

## Le LIS Stakeholders Update

Ce rapport montre, pour chaque laboratoire, si des données sont arrivées dans OpenLDR chaque jour ouvré d'un mois.

- Les dates sont dans l'en-tête des colonnes, le jour au-dessus du mois, et se répètent sur chaque page.
- Une case remplie veut dire que des données sont arrivées ce jour-là. Une case vide veut dire que rien n'est arrivé.
- Les week-ends sont exclus. Aucun calendrier des jours fériés ne s'applique, donc un jour férié compte comme jour ouvré.
- Les jours sont comptés dans le fuseau réglé dans **Paramètres**, **Laboratoire**, **Time zone**. Le filtre **Time zone** de l'exécution part de ce réglage, et vous pouvez le changer. Une exécution planifiée ou en ligne de commande ne lit pas ce réglage. Donnez-lui le fuseau directement.
- **HVL/EID panel codes** prend les codes que votre programme compte comme charge virale ou diagnostic précoce, à chaque exécution. Le reste va dans la grille Other.
- Un laboratoire qui n'a rien envoyé ce mois-là n'apparaît pas dans la grille.
- La vue **Tableur** et le CSV sont le résultat brut de la requête. Leur première ligne porte les dates des colonnes, pas un laboratoire, et ils ont la colonne de tri que la page cache. Sautez cette première ligne quand vous envoyez le fichier vers un autre outil.

## Le Clinical Microbiology Report

Ce rapport prend le **numéro de laboratoire** comme Request ID : le numéro du bon de demande et de l'étiquette de l'échantillon, tel que le système l'envoie, par exemple `TZDISATDS0013538`.

Un système de laboratoire découpe souvent un résultat de microbiologie en plusieurs demandes sous un même numéro. La culture qui a poussé est une demande, l'antibiogramme une autre. Le rapport lit toutes les demandes sous ce numéro et imprime un isolat avec ses sensibilités sur une page. Un échantillon qui a donné plus d'un germe est refusé, pas fusionné, car deux antibiogrammes sous un seul nom de germe se liraient comme un seul isolat. Un identifiant de demande unique fonctionne aussi.

## Dépannage

- **Exécuter est grisé.** Un filtre obligatoire est vide. Ouvrez **Paramètres** et remplissez chaque filtre marqué d'une étoile. La plupart des rapports demandent une période.
- **« date range not selected », ou un message qui nomme un paramètre.** Le rapport s'est exécuté sans une valeur nécessaire. Réglez-la dans **Paramètres** et relancez. Le message nomme le paramètre.
- **Le résultat est vide.** Élargissez la période, effacez les filtres facultatifs, ou vérifiez que les données sont chargées. Les rapports AMR restent vides sans données de microbiologie.
- **« no data for this report request » sur le Clinical Microbiology Report.** Ce numéro n'a pas de microbiologie. Une demande de biochimie ou de sérologie n'a pas de germe. Le rapport refuse au lieu d'imprimer une page vide, car un rapport de microbiologie sans germe se lirait comme une culture négative. Vérifiez d'abord les panels de la demande dans **Requête**.
- **Un rapport de microbiologie montre un germe sans sensibilités.** C'est en général un vrai résultat. La culture a poussé et aucun antibiogramme n'a été fait.
- **Chaque rapport de microbiologie a un tableau de sensibilités vide.** Vérifiez d'abord dans **Terminologie** le jeu de valeurs d'interprétation de l'antibiogramme. Le rapport choisit les sensibilités dans ce jeu. S'il n'a jamais été chargé sur cette installation, chaque tableau est vide, comme des cultures sans antibiogramme. Un tableau vide est un résultat. Tous vides, c'est un problème d'installation.
- **Un antibiogramme montre une colonne `(unmapped)`.** Ce sont des résultats que le rapport n'a pas pu rattacher à un antibiotique, souvent une ligne de synthèse, un résultat pour deux molécules, ou un résultat de microscopie noté S, I ou R. Ils restent visibles pour qu'on puisse les compter. Un grand nombre est un problème de qualité des données à signaler à la personne qui configure l'automate.
- **Un compte rendu manque dans Specimen Turnaround Time.** Il n'a pas d'échantillon lié, ou il a été émis avant la réception de son échantillon. Aucun des deux cas ne donne de délai.
- **Accès refusé.** Votre rôle peut voir les rapports, mais pas gérer les planifications, modifier les modèles, ni dépublier ou supprimer.
- **Une exécution précédente a échoué.** Ouvrez **Historique**, lisez l'erreur, changez les filtres et relancez.
- **Un rapport attendu manque.** Il est peut-être dépublié, ou pas encore créé. Voir le [Concepteur de rapports](/docs/report-designer).
- **Le LIS Stakeholders Update n'a pas de données un jour où un laboratoire en a envoyé.** Vérifiez d'abord **Paramètres**, **Laboratoire**, **Time zone**, ou le filtre **Time zone** de l'exécution. Les jours sont comptés dans ce fuseau. Un fuseau UTC sur une installation en avance sur UTC peut repousser une arrivée du soir à la veille.
- **Sur un entrepôt SQL Server, le réglage Time zone est inutilisable.** Ce réglage n'accepte que des noms de fuseau IANA, et SQL Server attend des noms Windows. Sur SQL Server, laissez le réglage vide et tapez le nom Windows dans le filtre **Time zone** de chaque exécution. Le réglage fonctionne sur PostgreSQL et sur MySQL ou MariaDB.
- **L'exécution est refusée avec un message qui nomme le filtre Time zone.** Le filtre a reçu un décalage signé comme `+3`, `+03:00` ou `Etc/GMT+3`. C'est refusé exprès. La base lit le signe à l'envers, donc `+3` veut dire trois heures derrière UTC, et la grille serait décalée du double sans rien pour le montrer. Tapez un fuseau nommé comme `Africa/Nairobi`, ou le nom Windows sur SQL Server. Un nom que l'entrepôt ne connaît pas n'est pas refusé ici. L'entrepôt le signale clairement lui-même.
- **Un laboratoire manque dans le LIS Stakeholders Update.** Il n'a rien envoyé ce mois-là. Si tous manquent, voyez d'abord le point suivant.
- **Tous les laboratoires manquent sur un entrepôt MySQL ou MariaDB.** Les tables de fuseaux horaires du serveur ne sont sans doute pas chargées. Tant que personne n'a lancé `mysql_tzinfo_to_sql` sur ce serveur, chaque jour est vide. La grille dessine ses dates sans aucune ligne, comme un mois où rien n'est arrivé. Demandez à l'administrateur de l'entrepôt de charger ces tables. PostgreSQL et SQL Server ne sont pas concernés.
- **La grille HVL/EID est vide mais pas la grille Other.** Les codes de **HVL/EID panel codes** ne correspondent pas à ce que ce laboratoire envoie. Le filtre est obligatoire, il n'était donc pas vide. Ouvrez **Requête**, trouvez une demande que vous savez être une charge virale ou un diagnostic précoce, et lisez son code de panel. C'est cette orthographe exacte, ponctuation et casse comprises, qu'il faut mettre dans le filtre.

## Guides associés

- [Concepteur de rapports](/docs/report-designer)
- [Requêtes personnalisées](/docs/query)
- [Tableaux de bord](/docs/dashboard)
- [Audit](/docs/audit)
