# Charger et envoyer des données

<!-- operator-platform -->

Effectuez la maintenance sur l'hôte OpenLDR, dans le dossier Compose installé. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez ces chemins. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les illustrations de fichiers montrent le texte à modifier dans le fichier indiqué. Ces images ne prouvent pas une opération réussie. Les données de démonstration sont facultatives.

## Trouver un workflow

Ouvrez une définition existante avant de l'inspecter ou de la modifier.

### 1. Ouvrir Workflows

Sélectionnez **Workflows** dans le menu principal.

![Ouvrez Workflows depuis le menu principal.](/docs-images/operator/workflows-guide-open-page.png)

### 2. Trouver le workflow

Utilisez **Search workflows** pour filtrer les noms. Effacez la recherche pour retrouver toute la liste.

![La recherche filtre les noms des workflows.](/docs-images/operator/workflows-guide-search.png)

### 3. Ouvrir sa ligne

Sélectionnez le nom du workflow. Cet exemple ouvre le workflow fourni **Ingest**.

![Ouvrez le workflow fourni Ingest.](/docs-images/operator/workflows-guide-ingest-row.png)

### 4. Ajuster le canevas

Sélectionnez **Fit View** en bas à gauche. Utilisez plus et moins pour zoomer. Pan déplace le canevas. Select trace une zone de sélection.

![Fit View affiche les nœuds dans le canevas.](/docs-images/operator/workflows-guide-fit.png)

## Définir le secret webhook d'Ingest

Effectuez cette tâche lorsqu'un émetteur autorisé a besoin d'un identifiant à copier. Un secret enregistré ne peut pas être révélé. Coordonnez d'abord son remplacement avec les émetteurs.

### 1. Sélectionner Ingest received

Sélectionnez le premier nœud, **Ingest received**.

![Sélectionnez le déclencheur webhook Ingest received.](/docs-images/operator/workflows-guide-trigger.png)

### 2. Ouvrir ses paramètres

Sélectionnez l'engrenage **Configure** au-dessus du nœud sélectionné.

![Configure ouvre les paramètres du nœud sélectionné.](/docs-images/operator/workflows-guide-configure.png)

### 3. Générer un nouveau secret

Sous **Secret**, sélectionnez **Replace secret**. Une valeur non enregistrée propose plutôt **Regenerate**.

![Replace secret génère une valeur à copier avant l'enregistrement.](/docs-images/operator/workflows-guide-replace-secret.png)

### 4. Copier la nouvelle valeur

Copiez le nouveau secret et gardez-le avec les identifiants de l'émetteur. URL et Header indiquent où et comment l'envoyer.

![Copiez le nouveau secret avant l'enregistrement. La valeur enregistrée ne peut pas être révélée.](/docs-images/operator/workflows-guide-copy-secret.png)

### 5. Enregistrer le workflow

Sélectionnez **Save** dans la barre d'outils.

![Save enregistre le workflow et son nouveau secret.](/docs-images/operator/workflows-guide-save.png)

### 6. Confirmer la modification système

Lisez l'avertissement du workflow système, puis sélectionnez **Save anyway** si vous souhaitez cette modification.

![Les workflows système exigent une confirmation explicite Save anyway.](/docs-images/operator/workflows-guide-confirm-save.png)

**Résultat attendu :** le message Workflow saved confirme l'écriture. Les émetteurs doivent utiliser le nouveau secret enregistré.

![Le message Workflow saved confirme cette écriture.](/docs-images/operator/workflows-guide-saved.png)

## Envoyer votre contenu par HTTPS

Utilisez URL et secret enregistrés. Ingest accepte un Bundle FHIR, un tableau de ressources ou des réponses de formulaire prises en charge. Le CLI accepte Bundle ou ressource unique, pas ce tableau brut. Aucun endpoint générique POST /fhir. Placez votre contenu approuvé dans data/your-payload.json.

### 1. Envoyer avec le secret et une clé de demande

Remplacez hôte, secret et clé. Chaque demande nouvelle a sa clé. Une reprise conserve clé et contenu. Ne publiez pas le secret. Cet envoi écrit selon le workflow ; ne lancez que si voulu.

```sh
{{operator:data-post}}
```

![Envoyer avec le secret et une clé de demande.](guide:operator-data-post)

### 2. Suivre une demande acceptée jusqu’à la fin

HTTP 202 signifie accepté, pas terminé. Utilisez statusUrl ou remplacez REQUEST_ID. Le secret reste requis. Une exécution terminée peut répondre 200 ; 500 indique échec, interruption ou annulation répondent 409. Examinez les effets incertains avant reprise. Secret absent ou faux : 401 ; chemin inconnu : 404.

```sh
{{operator:data-poll}}
```

![Suivre une demande acceptée jusqu’à la fin.](guide:operator-data-poll)

### 3. Examiner le reçu enregistré sur l’hôte

Remplacez REQUEST_ID. History distingue aussi reçus et exécutions. Un reçu en attente ou actif n’est pas terminé. Modifier ou désactiver un workflow peut annuler des travaux. Ne relancez pas en masse avec de nouvelles clés.

```sh
{{operator:data-receipt}}
```

![Examiner le reçu enregistré sur l’hôte.](guide:operator-data-receipt)

## Charger un fichier avec le CLI installé

Utilisez votre JSON FHIR valide, dans le dossier partagé data. Dans un dépôt de développement, utilisez pnpm openldr et les chemins de l’hôte. Exemples et tableaux de bord sont facultatifs ; les définitions essentielles restent disponibles.

### 1. Valider sans importer

Valider n’importe pas. Corrigez les erreurs. Un fichier introuvable est souvent hors de data ou sans préfixe data/.

```sh
{{operator:data-validate}}
```

![Valider sans importer.](guide:operator-data-validate)

### 2. Importer lorsque l’écriture est voulue

Cela écrit dans l’installation configurée. Une réussite indique lot et nombre de ressources. Zéro ressource ne prouve pas un import utile. Vérifiez convertisseur et format.

```sh
{{operator:data-ingest}}
```

![Importer lorsque l’écriture est voulue.](guide:operator-data-ingest)

### 3. Lire l’état du lot

Retrouvez l’identifiant affiché. Le worker API peut terminer de manière asynchrone. Un lot en attente n’est pas un import terminé.

```sh
{{operator:data-status}}
```

![Lire l’état du lot.](guide:operator-data-status)

### 4. Examiner les erreurs avant reprise

Remplacez BATCH_ID. Corrigez la cause avant pipeline retry. Les ressources FHIR sont projetées vers l’entrepôt ; leur affichage dépend aussi de la projection et des filtres.

```sh
{{operator:data-logs}}
```

![Examiner les erreurs avant reprise.](guide:operator-data-logs)

## Utiliser un convertisseur approuvé si nécessaire

FHIR est le défaut. Les autres formats exigent convertisseur et configuration adaptés. Utilisez un plugin signé approuvé en exploitation. Les exemples sont des alternatives, pas des fichiers requis.

### 1. Installer le plugin approuvé

Remplacez le nom par votre artefact approuvé dans data. Les builds reference-plugins sont des fichiers du dépôt, pas des chemins supposés sur une installation fournie.

```sh
{{operator:data-plugin}}
```

![Installer le plugin approuvé.](guide:operator-data-plugin)

### 2. Choisir son identifiant pour importer

Remplacez fichier et PLUGIN_ID. Utilisez les options documentées du plugin. Vérifiez ensuite le lot avec les commandes précédentes.

```sh
{{operator:data-plugin-ingest}}
```

![Choisir son identifiant pour importer.](guide:operator-data-plugin-ingest)

## Exemples de contenu facultatifs

### Exemples de contenus

**`bundle.json`** : le convertisseur par défaut `fhir-bundle` prend un `Bundle` FHIR (il lit chaque `entry.resource`) ou une seule ressource. Voici une **soumission de laboratoire cliniquement complète** : un patient, la **demande** (`ServiceRequest`) et le **résultat** (`Observation`) rattaché à cette demande :

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "p1",
        "identifier": [{ "system": "urn:lab:mrn", "value": "MRN-001" }],
        "gender": "female",
        "birthDate": "1990-05-01"
      }
    },
    {
      "resource": {
        "resourceType": "ServiceRequest",
        "id": "sr1",
        "status": "active",
        "intent": "order",
        "subject": { "reference": "Patient/p1" },
        "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }] }
      }
    },
    {
      "resource": {
        "resourceType": "Observation",
        "id": "o1",
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
        "basedOn": [{ "reference": "ServiceRequest/sr1" }],
        "subject": { "reference": "Patient/p1" },
        "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }] },
        "valueQuantity": { "value": 13.5, "unit": "g/dL" }
      }
    }
  ]
}
```

> Un **tableau JSON simple** de ressources n'est *pas* un Bundle et ne sera pas enregistré. Placez les ressources dans un `Bundle` comme ci-dessus, ou envoyez un seul objet ressource.

> **Niveau de validation.** Les envois par la porte d'entrée sont validés au niveau configuré (**Élevé par défaut**, dans **Paramètres → Zone dangereuse → Validation des données**, ou avec `openldr settings validation`). Au niveau Élevé, un **résultat de laboratoire** (une `Observation` avec le code de `category` `laboratory`, ou un `DiagnosticReport` `LAB`) **doit faire référence à sa demande** par `basedOn`. La `ServiceRequest` doit être dans le même lot ou déjà enregistrée. Sinon, **toute la soumission est rejetée** avec un `422` et un `OperationOutcome` qui liste ce qui manque. C'est pourquoi l'exemple ci-dessus inclut la `ServiceRequest` et y rattache l'`Observation`. Baissez le niveau à `medium` (demande présente mais non résolue) ou `low` (structure seulement) si vous le devez, mais Élevé est le réglage sûr pour les données de laboratoire.

**`results.csv` + `mapping.json`** : le plugin `tabular` transforme des lignes en FHIR. Son `--config` est un fichier JSON avec un `output` (`fhir` ou `rows`) et un `mapping` qui indique au plugin quelles colonnes deviennent quels champs FHIR :

```
mrn,sex,dob,test,value,unit
MRN-001,female,1990-05-01,Hemoglobin,13.5,g/dL
```

Les clés exactes de `mapping` sont définies par le plugin tabular. Elles se modifient aussi depuis son nœud dans **Flux de travail** (le même plugin fait tourner le nœud **Tabular** des flux). Vous pouvez donc créer et prévisualiser une correspondance dans l'application avant de l'enregistrer sous `mapping.json`.

## Paramètres de l’émetteur CDR

### Envoyer du FHIR déjà construit (la chaîne d'outils CDR)

La branche FHIR du flux **Ingest** est la porte d'entrée pour un système qui produit déjà des ressources FHIR. C'est surtout le cas de la **chaîne d'outils CDR**, qui envoie un **Bundle de transaction FHIR**. Dans les versions actuelles de la chaîne d'outils CDR, le chemin cible (`OPENLDR_CE_HOOK_PATH`) vise **par défaut** le webhook unifié (`/api/workflows/hooks/ingest`). Aucun réglage de chemin n'est donc nécessaire au départ. Une **chaîne d'outils plus ancienne, ou une dont le `.env` fixe encore l'ancien chemin `cdr-ingest`**, doit définir `OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest` (le chemin **complet**, pas `ingest` seul) pour le viser. Le pipeline est **Webhook → Switch → Unwrap FHIR Bundle → Persist / Store → Log** :

- Le corps de la requête est un **Bundle de transaction FHIR** (ou un tableau simple de ressources FHIR). **Unwrap FHIR Bundle** résout les références internes et le découpe en **un élément par ressource**, car **Persist / Store enregistre une ressource FHIR par élément d'entrée**. C'est le même chemin d'écriture (et le même **contrôle du niveau de validation**) que celui de la CLI.
- **Un seul webhook traite ensemble les examens et les questionnaires.** Persist enregistre chaque ressource, et la projection oriente chacune selon son `resourceType` (`Observation` → `lab_results`, `ServiceRequest` → `lab_requests`, `QuestionnaireResponse` → `questionnaire_responses`, …).

Pour connecter la chaîne d'outils CDR à un déploiement, copiez le secret du webhook **Ingest** et définissez :

**`CDR toolchain .env`**

```dotenv
OPENLDR_CE_URL=https://your-host        # base URL of the CE deployment
OPENLDR_CE_WEBHOOK_TOKEN=<the-secret>   # the Ingest webhook secret you copied
OPENLDR_CE_TIMEZONE=+03:00              # UTC offset for DISA's unzoned timestamps (per country)
# OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest  # optional — this is already the default
```

`OPENLDR_CE_TIMEZONE` est **obligatoire** et n'a pas de valeur par défaut sûre. DISA enregistre les heures locales sans fuseau horaire, donc un décalage omis déplacerait en silence chaque horodatage clinique. Réglez-le selon le pays du déploiement (Tanzanie `+03:00` ; Mozambique/Zambie `+02:00`).

> **Le webhook veut un Bundle ou un tableau, mais pas la CLI.** La branche FHIR du webhook `ingest` accepte un **Bundle** de transaction ou un simple **tableau** de ressources. La **CLI** `openldr ingest` ci-dessous est plus stricte : elle prend un **Bundle** FHIR (ou une seule ressource), pas un tableau. Envoyez chaque contenu vers la voie qui correspond à sa forme.

Si vous avez simplement un fichier Bundle, `openldr ingest bundle.json` (ci-dessous) est la voie clé en main. Elle applique le même convertisseur et le même contrôle de validation sans créer de flux de travail.

## 3. Synchronisation distribuée (laboratoire ↔ central, pas pour les tiers)

Si cette instance est un **laboratoire** inscrit auprès d'un serveur OpenLDR **central**, ses données remontent automatiquement par le canal de synchronisation (`POST /api/sync/push`, authentifié par les identifiants machine du laboratoire). Il s'agit uniquement de réplication laboratoire↔central : un système tiers ne peut pas y envoyer de données. Voir le guide **Synchronisation distribuée** dans l'application.

## Où vont les données

Les ressources ingérées arrivent dans le magasin FHIR interne et sont projetées dans l'entrepôt analytique que lisent les rapports et les tableaux de bord. Si des données sont ingérées mais n'apparaissent pas dans un rapport, vérifiez que le stockage cible est configuré (voir [Variables d'environnement](/docs/environment)) et laissez un moment à la projection pour rattraper son retard.

### Faits et attributs des demandes

Chaque demande de laboratoire porte, quand la source les envoie : l'ensemble OBR, l'heure d'analyse, le lieu de soins, le type de demande, qui l'a enregistrée et analysée, le médecin demandeur, l'âge au moment de la demande, les informations cliniques, l'analyseur, ainsi que le code et le motif de rejet. Chaque compte rendu porte sa section et la personne qui l'a validé.

Les faits plus rares sont des lignes de `lab_request_attributes`, une ligne par demande et par attribut. Les codes d'attribut forment le système de codes `urn:openldr:cs:request-attribute`. Chargez-le une fois avec :

    pnpm openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

Lancez cette commande depuis une copie des sources du dépôt OpenLDR CE, où le fichier se trouve à ce chemin. Sans l'importation, les lignes d'attribut sont quand même enregistrées. Seuls les libellés des codes manquent.

Un fait que la source n'envoie pas reste vide. Rien n'est complété.

Un résultat numérique hors de la plage de rendu du laboratoire arrive sous forme de limite avec un comparateur, par exemple `< 20`. `lab_results.numeric_comparator` contient `<`, `<=`, `>=` ou `>`, et reste vide pour un nombre ordinaire. Dans ce cas, `numeric_value` contient la limite.

Chaque résultat porte son statut FHIR dans `lab_results.status`. Un examen rejeté à la saisie du résultat est enregistré comme une ligne de statut `cancelled`, sans valeur, avec le motif dans `data_absent_code` et `data_absent_reason`, par exemple `HAEM` et `Haemolysed`. Pour compter les résultats, ajoutez `(l.status is null or l.status <> 'cancelled')` à la requête. Pour compter les examens rejetés, utilisez `l.status = 'cancelled'`. Qualifiez `status` avec l'alias de lab_results, car lab_requests, specimens et diagnostic_reports ont aussi une colonne `status`. Une ancienne requête qui les joint et utilise `status` seul doit être qualifiée. Une installation mise à niveau depuis une version antérieure n'a pas de statut sur les lignes qu'elle contenait déjà. Lancez `openldr db reproject --force` une fois après la mise à niveau pour les remplir.

`clinical_info` est masqué par défaut dans le concepteur de tableaux de bord, car il peut contenir du texte libre ou un id patient pseudonyme. Affichez-le dans Paramètres, puis Exposition des données. La table `lab_request_attributes` n'apparaît pas du tout dans le concepteur de tableaux de bord. Lisez-la avec des requêtes personnalisées.
