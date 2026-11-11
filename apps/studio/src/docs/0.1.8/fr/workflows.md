# Flux de travail

Un flux de travail est une chaîne d'étapes qui tourne seule. Il peut recevoir des données en HTTP, les vérifier, les enregistrer, interroger une base, remodeler des lignes, construire un tableur et l'envoyer par e-mail. Vous le construisez sur un canevas en faisant glisser des étapes, les **nœuds**, et en les reliant par des lignes. Aucun programme à écrire.

Ce guide prend environ 40 minutes. Vous préparez le flux **Ingest** fourni pour recevoir des données en HTTP, vous lui envoyez un enregistrement, vous lisez l'exécution, puis vous construisez un petit flux à vous. Sélectionnez une image ou un clip pour l'agrandir. L'écran des flux de travail est presque entièrement en anglais, donc ce guide écrit les libellés en anglais.

![La liste des flux sur une nouvelle installation : Ingest et On Ingest Persisted → Log.](workflows-tour.png)

## Qui peut faire quoi

Les noms des autorisations s'affichent en anglais.

| Autorisation | Ce qu'elle permet |
| --- | --- |
| View workflows | Ouvrir **Flux de travail**, voir les définitions et leurs exécutions. |
| Edit workflows | Créer, modifier, importer et supprimer des flux. |
| Run workflows | Lancer une exécution à la main. |
| Manage workflow secrets | Régler des secrets chiffrés, comme un secret de webhook. |

Lab Admin et Lab Manager les ont par défaut.

## Ce que contient une nouvelle installation

| Flux | Ce qu'il fait |
| --- | --- |
| **Ingest** | Reçoit les données envoyées à `/api/workflows/hooks/ingest`. Un nœud **Switch** regarde leur forme. Un Bundle FHIR, ou une liste de ressources FHIR, est découpé en un élément par ressource. Un simple objet de réponses de formulaire est vérifié avec le formulaire **Lab order**. Les deux branches finissent dans **Persist store**, qui enregistre les données. La saisie à la main dans **Formulaires** passe aussi par ce flux, gardez-le donc activé. |
| **On Ingest Persisted → Log** | S'exécute chaque fois qu'Ingest enregistre quelque chose, et écrit une ligne de journal. Un point de départ pour vos propres réactions aux nouvelles données. |

Ce sont des **flux système**. Enregistrer une modification demande d'abord une confirmation, car un Ingest cassé arrête l'enregistrement des données. **Reset to default**, dans le menu de sa ligne, remet la version d'origine.

## Les idées de base

- **Nœuds et lignes.** Chaque nœud fait une étape. Les données passent le long des lignes sous forme d'une liste d'**éléments**. Chaque élément est un enregistrement avec un objet `json` et, parfois, des fichiers joints.
- **Déclencheurs.** Chaque flux commence par un nœud déclencheur : à la main, planifié, webhook, chargement de données, événement, ou écoute.
- **Configure Node.** Sélectionnez un nœud, puis son engrenage, pour le régler dans le panneau de droite. Le panneau a les onglets **Config**, **Input** et **Output**.
- **Jeux de données.** Un flux peut enregistrer son résultat comme jeu de données nommé. D'autres flux, tableaux de bord et rapports peuvent le lire ensuite. C'est ainsi qu'un flux lourd « préparer les données » passe la main à un flux léger « les livrer ».

## Exemple 1 : préparer le webhook Ingest

Une nouvelle installation génère un secret pour le webhook Ingest, mais personne ne peut lire un secret enregistré. Pour envoyer des données, remplacez-le et copiez le nouveau avant d'enregistrer.

![Ouvrir Ingest, ouvrir son déclencheur, remplacer le secret et enregistrer.](workflows-ingest-secret.mp4)

1. Ouvrez **Flux de travail** et sélectionnez **Ingest**. Le canevas s'ouvre.
2. Sélectionnez **Fit View**, le carré en bas à gauche du canevas, pour voir les six nœuds.
3. Sélectionnez le premier nœud, **Ingest received**, puis l'engrenage au-dessus. **Configure Node** s'ouvre à droite.
4. Sous **Secret**, sélectionnez **Remplacer le secret**. Un nouveau secret apparaît dans la zone.
5. Copiez-le maintenant. Vous ne pourrez plus le voir après l'enregistrement.
6. Sélectionnez **Save** en haut. Ingest est un flux système, une question s'affiche donc : **Save changes to a system workflow?** Sélectionnez **Save anyway**.

![Configure Node du déclencheur webhook : chemin, URL, nouveau secret et en-tête à envoyer.](workflows-ingest-panel.png)

**Résultat attendu :** le message **Workflow saved**. Le panneau montre l'**URL** complète et l'en-tête à envoyer : `X-Webhook-Token: <votre secret>`. Chaque instance de l'API prend le nouveau secret tout de suite. Aucun redémarrage n'est nécessaire.

## Exemple 2 : envoyer un enregistrement

Envoyez un patient de l'exemple de la documentation. Il est déjà dans les données d'exemple, avec le même identifiant, donc il met ce patient à jour et aucun compte ne change.

1. Téléchargez le fichier d'exemple si ce n'est pas déjà fait. Voir [Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).
2. Sortez le premier patient dans son propre Bundle :

```bash
jq '{resourceType:"Bundle",type:"transaction",entry:[.entry[]|select(.resource.id=="sample-pat-0001")]}' \
  data/openldr-sample-lab-data.json > one-patient.json
```

3. Envoyez-le, avec le secret copié :

```bash
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: <votre secret>" \
  -d @one-patient.json
```

**Résultat attendu :** une réponse comme `{"ok":true,"runId":"...","correlationId":"..."}`. Un secret faux ou absent renvoie `401`. Un mauvais chemin renvoie `404`.

Envoyez toujours en HTTPS, pour que le secret ne circule pas en clair. Traitez-le comme un mot de passe.

## Exemple 3 : lire l'exécution

![Ouvrir History et choisir l'exécution.](workflows-history.mp4)

1. Sur le canevas d'Ingest, sélectionnez **History**.
2. L'onglet **Runs** liste chaque exécution. Sélectionnez la plus récente.

![Une exécution : type, statut et durée de chaque nœud, et les données transmises.](workflows-run-detail.png)

**Résultat attendu :** **Completed**, lancée par **webhook**. Chaque nœud affiche **success**, sauf **form-validate-1**, qui affiche **skipped** : un Bundle prend la branche FHIR, pas celle des formulaires. Sélectionnez un nœud pour voir son **Output**, son **Result** et ses **Logs** en dessous.

L'onglet **Webhook receipts** liste chaque requête acceptée par le webhook, avec son statut. Voir [Requêtes webhook durables](#requetes-webhook-durables).

Le même enregistrement apparaît maintenant dans [Activité](/docs/activity).

## Exemple 4 : construire un flux

Construisez un flux qui compte les demandes de chaque examen dans l'entrepôt.

![Créer un flux : un Manual Trigger et un nœud Postgres, reliés, réglés, enregistrés et exécutés.](workflows-build.mp4)

1. Dans la liste des flux, ouvrez le menu en haut à droite et sélectionnez **New**.
2. Remplacez **Untitled Workflow** par `Orders by test`.
3. Dans la **Node library** à gauche, ouvrez **Core** et faites glisser **Manual Trigger** sur le canevas.
4. Ouvrez **Databases** et faites glisser **Postgres** à sa droite.
5. Faites glisser du point à droite de **Manual Trigger** jusqu'au point à gauche de **Postgres**. Une ligne les relie.
6. Sélectionnez **Postgres**, puis son engrenage. Choisissez le connecteur **Target Warehouse (Postgres)**. Dans la zone SQL, tapez :

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
GROUP BY panel_desc
ORDER BY orders DESC
```

7. Sélectionnez **Save**.
8. Sélectionnez **Run**. La barre du bas affiche **Waiting for trigger**. Sélectionnez le badge lecture sur **Manual Trigger** pour démarrer.

**Résultat attendu :** la barre du bas affiche **Completed** et **2 steps**. Ouvrez **Postgres**, puis **Output** : cinq éléments, Full blood count 18 en premier.

![La sortie du nœud Postgres : un élément par ligne.](workflows-build-output.png)

Les nombres venus du SQL arrivent comme du texte, par exemple `"18"`. Un nœud suivant qui fait des sommes devra peut-être les convertir.

Pour terminer ce guide, supprimez le flux : dans la liste, ouvrez le menu de sa ligne et sélectionnez **Delete**.

## La liste des flux

- **New** et **Import** sont dans le menu en haut à droite. **Import** lit un fichier créé par **Export**.
- Chaque ligne a **Open**, **Duplicate**, **Export**, et soit **Delete**, soit, pour un flux système, **Reset to default**.
- **Search workflows** filtre par nom.

## Se déplacer sur le canevas

Utilisez les commandes en bas à gauche du canevas :

- **+** zoome et **−** dézoome.
- **Fit View**, en dessous, montre tous les nœuds.

L'icône de main en haut à gauche est le mode **Pan** : faites glisser une zone vide pour déplacer la vue. L'icône de pointeur est le mode **Select** : faites glisser pour sélectionner des nœuds dans un cadre. En mode **Select**, le bouton du milieu ou le bouton droit de la souris déplace la vue.

La mini-carte en bas à droite permet aussi de se déplacer et de zoomer. Si vous perdez vos nœuds, utilisez **Fit View** avant d'en déplacer un. Ces commandes changent la vue, pas les positions enregistrées.

Les boutons du haut : **Clear** vide le canevas, **Datasets** liste les jeux de données enregistrés, **History** ouvre les exécutions, **Save** enregistre, **Run** prépare une exécution.

## Valeurs de l'élément entrant

La plupart des champs texte acceptent des modèles qui lisent l'élément en cours : SQL, destinataire, objet et corps d'e-mail, noms de fichiers.

- `{{ $json.fieldName }}` est un champ de l'élément entrant.
- Dans un nœud SQL : `... where registered >= '{{ $json.periodStart }}'`, où un nœud **Edit Fields** plus tôt a réglé `periodStart`.

## Référence des nœuds

La **Node library** range les nœuds par usage : **Core**, **Communication**, **Developer Tools**, **Databases**, **Files & Storage** et **Data Transformation**. Tapez dans **Search nodes** pour en trouver un.

### Déclencheurs

- **Manual Trigger**, **Schedule**, **Webhook**, **On Data Ingest**. Démarrent à la demande, selon un planning cron, depuis un appel HTTP, ou quand un lot est chargé.
- **Event Trigger**. Démarre quand un événement se produit, par exemple des données enregistrées.
- **Postgres Trigger** et **Email Trigger**. Démarrent sur un `NOTIFY` Postgres, ou à l'arrivée d'un e-mail par un connecteur IMAP.

### Faire entrer des données

- **Postgres**, **MySQL**, **Microsoft SQL**. Exécutent du SQL par un connecteur de base de données et produisent un élément par ligne. Le connecteur fixe le dialecte. Utilisez `{{ $json.x }}` pour y mettre des valeurs. Gardez des `SELECT` simples et faites le remodelage dans des nœuds, pour que le même flux marche sur une autre base.
- **SQL Query**. Exécute un `SELECT` sur le schéma de reporting. Il faut activer **SQL brut pour les tableaux de bord** dans **Paramètres**, **Général**. Sinon il échoue avec `raw SQL widgets are disabled`. Le nœud Postgres n'a pas besoin de ce réglage.
- **Load Dataset**. Lit un jeu de données enregistré plus tôt.
- **HTTP Request** et **FHIR Query**. Vont chercher dans une API ou dans le magasin FHIR.

### Remodeler les données

- **Edit Fields**. Ajoute ou calcule des champs sur chaque élément, comme `periodStart` et `periodEnd`.
- **Pivot**. Transforme des lignes longues en colonnes larges. Choisissez les clés de **group-by**, la **pivot column** dont les valeurs deviennent des noms de colonnes, la **value column**, et une liste fixe de colonnes de sortie. Exemple : un antibiotique par ligne devient une colonne par antibiotique. Les conflits se combinent par `max`, `min`, `first` ou `last`.
- **Merge**. Combine des branches entrantes. *Append* les empile, *Combine* fusionne un objet, *Choose Branch* en choisit une, et **Combine by key** joint deux branches sur des champs communs, à gauche ou interne. La première branche reliée est le côté gauche.
- **If**, **Switch**, **Filter**. Bifurquent ou retirent des éléments selon une condition.
- **Aggregate**, **Summarize**, **Sort**, **Limit**, **Remove Duplicates**, **Rename Keys**, **Split Out**, **Date & Time**. Les opérations courantes sur des tableaux.
- **Unwrap FHIR Bundle**. Un élément par ressource d'un Bundle.

### Fichiers et sorties

- **Excel Template**. Remplit un modèle `.xlsx` à vos couleurs avec les lignes et le renvoie comme fichier. Chargez le modèle avec le bouton du nœud, réglez la **Start cell** comme `A2`, les **Columns** dans l'ordre, une **Auto-filter header cell** facultative comme `A1`, et un mot de passe facultatif. Les valeurs sont placées par position, comme dans un rapport fait à la main.
- **Export File**, **Spreadsheet File**, **Convert to File**. CSV, XLSX ou PDF simples à partir des éléments, sans modèle.
- **Materialize Dataset**. Enregistre les éléments comme jeu de données nommé.
- **Read/Write File**. Accès aux fichiers du serveur, dans un bac à sable, quand il est activé.

### Communication

- **Send Email (SMTP)**, **Gmail**, **Outlook**. Envoient par un connecteur e-mail. Réglez **To**, **Cc** facultatif, **Subject**, **Body**, **Body format**, et l'**Attachment field**, par exemple le champ `file` d'un nœud Excel Template.

### Contrôle du déroulement

- **Wait**, **Execute Workflow**, **Loop Over Items**, **Stop and Error**, **No Operation**. Mettre en pause, appeler un autre flux, répéter, ou échouer exprès.

### Saisie des données

- **Form Validate**. Vérifie des éléments avec un formulaire et les transforme en ressources FHIR.
- **Persist Store**. Enregistre des ressources FHIR et déclenche `data.persisted`.

## Rapports planifiés

L'usage le plus courant au laboratoire est « interroger une base selon un planning, remplir un modèle, l'envoyer par e-mail ». Il a son propre guide : [Rapports planifiés avec les flux de travail](/docs/report-pipeline).

## Webhooks sur plusieurs instances de l'API

Enregistrez un changement de chemin ou de secret avant d'envoyer des requêtes avec la nouvelle valeur. Chaque instance de l'API lit le chemin et le secret actuels dans la base partagée. Aucun redémarrage n'est nécessaire. Les requêtes authentifiées avant l'enregistrement peuvent finir.

Envoyez le secret seulement dans l'en-tête `x-webhook-token`.

| Réponse | Sens |
| --- | --- |
| 404 | Ancien chemin après un changement, ou flux désactivé ou supprimé |
| 401 | Secret ancien ou illisible |
| 503 | Deux déclencheurs activés partagent un chemin, donc rien ne s'exécute. Aussi une erreur de lecture de la base. Les instances ne se rabattent jamais sur des identifiants en cache. |

Chaque déclencheur activé a besoin de son propre chemin, y compris dans un même flux.

Arrêtez chaque ancienne instance de l'API et chaque ancien écrivain de flux avant de lancer la migration 096 avec `openldr db migrate`. Démarrez ensuite les instances à jour. Les anciens écrivains ne savent pas tenir le nouvel index des chemins. Cette mise à jour demande un arrêt. Ne mélangez pas les versions pendant que des écritures arrivent. Toutes les instances doivent utiliser la même base et la même clé de chiffrement.

## Requêtes webhook durables

OpenLDR enregistre un reçu et un événement d'envoi dans une seule transaction de base avant d'accepter un webhook. Si cela n'atteint pas la base, la requête échoue sans reçu. Une erreur ou une connexion perdue ne prouve pas que rien n'a tourné. Réessayez avec la même clé d'idempotence et les mêmes données.

Envoyez un en-tête `Idempotency-Key` facultatif pour chaque requête logique. Dans un même flux, la même clé et les mêmes données réutilisent le premier reçu. Des données différentes avec la même clé renvoient 409. Les données comprennent le corps, la requête, les en-têtes transmis et le contenu binaire. Les en-têtes d'authentification et de transport ne comptent pas. Sans clé, chaque POST est une nouvelle requête, et les nouvelles tentatives peuvent répéter leurs effets.

OpenLDR attend jusqu'à 10 secondes après l'acceptation :

- Un travail fini renvoie 200 avec les champs habituels. Une répétition d'une requête finie renvoie aussi 200, même avec `Prefer: respond-async`.
- Un échec enregistré renvoie un 500 simple avec `requestId`, sans l'erreur brute.
- Les reçus interrompus et annulés renvoient 409.
- Un travail en file ou en cours renvoie 202 avec `accepted: true`, `requestId`, `status` et `statusUrl`. `Location` et `Retry-After` donnent l'adresse et l'intervalle d'interrogation. 202 veut dire accepté, pas fini.
- `Prefer: respond-async` saute l'attente. Se déconnecter n'annule pas un travail accepté.

### Exemple pour l'expéditeur

Une réponse 200 finie peut être `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. Les clés comptent de 1 à 200 caractères ASCII imprimables, sans espaces.

Envoyez `POST /api/workflows/hooks/example` avec les en-têtes `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` et `Prefer: respond-async`. Réessayez avec la même clé et les mêmes données.

Un corps 202 en attente :

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Interrogez-le avec `GET /api/workflows/hooks/example?requestId=request-id` et le `x-webhook-token` actuel. Respectez `Retry-After`. L'interrogation ne renvoie que `requestId`, `status` et `runId`, jamais de données ni d'erreurs brutes. L'identifiant de requête seul ne donne aucun accès. Un secret remplacé cesse de marcher tout de suite. Un chemin renommé ou supprimé peut couper l'expéditeur, mais les opérateurs peuvent encore retrouver les reçus par flux et par identifiant de requête.

### Inspecter et reprendre

L'onglet **Webhook receipts** de **History** montre les requêtes en file, en cours, finies, échouées, interrompues et annulées. Les routes de l'API sont `GET /api/workflows/:id/receipts?limit=25&offset=0` et `GET /api/workflows/:id/receipts/:requestId`.

```bash
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

Les limites vont de 1 à 100. Les décalages commencent à zéro. La ligne de commande et l'API utilisent le même service de reçus. Aucune ne rejoue une requête.

Un travail en file peut reprendre après un redémarrage. Un flux désactivé, supprimé ou modifié avant de tourner annule le travail en file. `interrupted` veut dire que l'issue est inconnue. OpenLDR ne rejoue jamais seul un travail commencé. Vérifiez que le premier processus s'est arrêté, et corrigez les effets extérieurs, avant d'envoyer une requête avec une nouvelle clé. Les effets extérieurs ne sont pas annulés.

Les reçus et les enregistrements d'idempotence survivent à la suppression d'un flux. Rien n'expire ni ne les nettoie, donc le stockage grandit. La migration 097 ajoute le stockage des reçus. Mettez à jour de la même façon : arrêtez les anciennes instances et les anciens écrivains, lancez `openldr db migrate`, puis démarrez les nouvelles. La compatibilité du client CDR avec ces réponses n'a pas été vérifiée dans son code source.

## Sur un téléphone

La liste des flux marche sur un téléphone. Le canevas demande un ordinateur : construisez et modifiez les flux sur un écran plus grand.

![La liste des flux sur un téléphone.](workflows-phone.png)

## Dépannage

- **Le webhook répond 401.** Le secret est faux ou ancien. Un secret enregistré ne se lit pas, donc remplacez-le, copiez le nouveau et enregistrez. Voir [Exemple 1](#exemple-1-preparer-le-webhook-ingest).
- **Save sur Ingest semble ne rien faire.** Cherchez la question **Save changes to a system workflow?** et sélectionnez **Save anyway**.
- **Un nœud ne peut pas tourner.** Ouvrez-le et remplissez chaque champ obligatoire. Un nœud de base de données ou d'e-mail demande un connecteur.
- **Un connecteur manque dans un nœud.** Vérifiez que le connecteur existe, est activé, et correspond au type du nœud. Voir [Connecteurs](/docs/connectors).
- **Le nœud SQL Query échoue avec `raw SQL widgets are disabled`.** Activez **SQL brut pour les tableaux de bord**, ou utilisez le nœud **Postgres**, **MySQL** ou **Microsoft SQL** avec un connecteur.
- **Run ne fait rien.** **Run** ne fait que préparer le flux. Sélectionnez le badge lecture sur le déclencheur.
- **Un jeu de données est vide.** Exécutez le flux qui le construit avant celui qui le lit.
- **Un e-mail est arrivé sans la pièce jointe.** Réglez l'**Attachment field** du nœud Send Email sur le champ de fichier créé plus tôt, en général `file`.
- **Une exécution échoue après une branche.** Vérifiez la condition de la branche, et le nœud juste avant l'échec.
- **La saisie de formulaire échoue avec « capture pipeline unavailable ».** Ingest est désactivé. Le serveur le réactive au démarrage. Si vous l'avez désactivé exprès, la saisie de formulaire ne peut pas marcher.

## Conseils

- Découpez un travail lourd en deux flux reliés par un jeu de données. L'un enregistre les données préparées selon un planning. Un plus léger les charge, les met en forme et les envoie. La requête source reste rapide.
- Gardez des requêtes de base en `SELECT` simples. Faites les pivots et les jointures dans les nœuds **Pivot** et **Merge**, pour qu'un flux construit pour une base tourne sur une autre en changeant le connecteur.
- Lisez **History** avant de modifier un flux qui échoue, pour savoir si le problème vient des données, du réglage ou de la destination.

## Guides associés

- [Activité](/docs/activity)
- [Rapports planifiés avec les flux de travail](/docs/report-pipeline)
- [Connecteurs](/docs/connectors)
- [Rapports](/docs/reports)
- [Audit](/docs/audit)
