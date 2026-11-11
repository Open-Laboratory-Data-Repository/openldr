# Charger et envoyer des données

Une fois OpenLDR démarré, vous devez y faire entrer des données de laboratoire. OpenLDR n'a **aucun point de terminaison générique d'ingestion FHIR** : il n'existe pas de `POST /fhir` auquel envoyer des ressources. Les données arrivent par l'une des voies ci-dessous. Le choix dépend surtout de votre mode d'installation.

> **Où se trouve la CLI `openldr` ?** Les deux types d'installation l'ont. L'installateur Docker en une ligne écrit un script `openldr` dans le dossier d'installation. Lancez-le depuis ce dossier avec `./openldr …` (`.\openldr.ps1` sous Windows). Depuis une copie du dépôt, lancez plutôt `pnpm openldr …`. Dans les deux cas, vous n'avez pas besoin de la CLI pour commencer : l'installateur définit `MIGRATE_ON_START=true` et `SEED_ON_START=true`. La pile applique donc ses migrations et charge ses données de départ au premier démarrage, et le **webhook HTTP** ci-dessous fonctionne sur toute installation.
>
> Une différence compte pour les arguments de fichier. Le script exécute la CLI dans le conteneur `api`, qui ne voit que le dossier `data`. Placez donc les fichiers dans `./data` et nommez-les avec le préfixe `data/`. Une copie des sources utilise les chemins ordinaires de l'hôte. Voir [la page CLI](/docs/cli).

## 1. Envoyer en HTTP avec un webhook de flux de travail (toute installation)

La voie HTTP entrante est un **flux de travail** avec un déclencheur **Webhook**. Le corps de la requête est transmis au flux comme entrée, et **ce qui est enregistré dépend entièrement de ce que le flux en fait**. Vous contrôlez donc la forme exacte (une soumission de formulaire, des données d'un fournisseur, ou un Bundle FHIR que vous normalisez dans le flux).

Une nouvelle installation fournit **un** flux de travail webhook d'ingestion, **Ingest** (`wf-ingest`), qui oriente les données selon la **forme** du corps envoyé. **Une nouvelle installation le livre activé** : la saisie manuelle de la page **Formulaires** passe par lui. Il est donc indispensable à l'installation, pas facultatif. (Sur une installation **mise à niveau**, une version antérieure a pu le laisser désactivé. Voir *Vous mettez à niveau une installation existante ?* ci-dessous.) Son point de terminaison HTTP reste fermé à quiconque n'a pas le secret propre à l'installation :

| Flux de travail | Chemin du webhook | Attend | Comportement |
|---|---|---|---|
| **Ingest** | `ingest` | un **Bundle** de transaction FHIR, un **tableau simple** de ressources FHIR, ou un simple objet `{…}` de **réponses de formulaire** | un nœud **Switch** vérifie la forme : Bundle/tableau → **Unwrap FHIR Bundle** (un élément par ressource, références résolues) ; objet → **Form Validate** avec le formulaire « Lab order » chargé par défaut. Les deux branches enregistrent par le même **Persist / Store** |

Pour l'utiliser :

1. Dans l'application, ouvrez **Flux de travail**, puis **Ingest**.
2. Ouvrez son déclencheur **Webhook**. Un secret enregistré ne peut pas être relu. Choisissez donc **Remplacer le secret**, copiez le nouveau secret, puis enregistrez le flux. Ingest est un flux système : confirmez avec **Save anyway**. Le déclencheur a un chemin d'URL fixe (`ingest`).
3. Envoyez les données depuis votre système externe :

```bash
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: <the-webhook-secret>" \
  -d @order.json
```

**Sécurité :** le secret est envoyé dans l'en-tête `X-Webhook-Token` et vérifié en temps constant sur le serveur. Faites toujours le POST en **HTTPS** pour ne pas exposer le jeton. Traitez le secret comme un mot de passe, et changez-le en modifiant le déclencheur webhook du flux. Un jeton faux ou absent est rejeté avec `401`. Un chemin inconnu renvoie `404`.

Vous pouvez aussi créer votre propre flux webhook (**Webhook → transformation/validation → Persist / Store**) pour toute autre forme de données. **Ingest** couvre simplement les cas courants dès l'installation.

> **Vous mettez à niveau une installation existante ?** Les flux de travail sont chargés par id et jamais écrasés. Une mise à niveau garde donc la ligne `wf-ingest` que vous avez déjà, y compris vos modifications de son graphe.
>
> - **État activé.** Les versions antérieures livraient `wf-ingest` **désactivé**. Comme la saisie manuelle passe maintenant par lui, un `wf-ingest` désactivé ferait échouer chaque soumission de formulaire avec *« capture pipeline unavailable »*. Le serveur **l'active donc pour vous au démarrage** s'il le trouve désactivé. Ce changement d'un seul indicateur laisse intacts votre graphe de nœuds, le nom et le secret du webhook. Rien d'autre dans le flux n'est rechargé. Si vous voulez vraiment le désactiver, vous devez aussi cesser d'utiliser la saisie manuelle, car les deux ne peuvent pas être séparés.
> - **Vos modifications.** Une mise à niveau n'écrase jamais un graphe `wf-ingest` personnalisé. Si vous avez besoin du graphe d'origine, utilisez **Reset to default** dans le menu ⋯ du flux.
> - **Flux retirés.** Sur un déploiement antérieur au câblage unifié, les anciens `wf-ingest-form` / `wf-ingest-raw` restent (désactivés) et peuvent être supprimés à la main. L'ancien flux réactif associé continue d'écouter l'ancienne source d'événements.

### Envoyer du FHIR déjà construit (la chaîne d'outils CDR)

La branche FHIR du flux **Ingest** est la porte d'entrée pour un système qui produit déjà des ressources FHIR. C'est surtout le cas de la **chaîne d'outils CDR**, qui envoie un **Bundle de transaction FHIR**. Dans les versions actuelles de la chaîne d'outils CDR, le chemin cible (`OPENLDR_CE_HOOK_PATH`) vise **par défaut** le webhook unifié (`/api/workflows/hooks/ingest`). Aucun réglage de chemin n'est donc nécessaire au départ. Une **chaîne d'outils plus ancienne, ou une dont le `.env` fixe encore l'ancien chemin `cdr-ingest`**, doit définir `OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest` (le chemin **complet**, pas `ingest` seul) pour le viser. Le pipeline est **Webhook → Switch → Unwrap FHIR Bundle → Persist / Store → Log** :

- Le corps de la requête est un **Bundle de transaction FHIR** (ou un tableau simple de ressources FHIR). **Unwrap FHIR Bundle** résout les références internes et le découpe en **un élément par ressource**, car **Persist / Store enregistre une ressource FHIR par élément d'entrée**. C'est le même chemin d'écriture (et le même **contrôle du niveau de validation**) que celui de la CLI.
- **Un seul webhook traite ensemble les examens et les questionnaires.** Persist enregistre chaque ressource, et la projection oriente chacune selon son `resourceType` (`Observation` → `lab_results`, `ServiceRequest` → `lab_requests`, `QuestionnaireResponse` → `questionnaire_responses`, …).

Pour connecter la chaîne d'outils CDR à un déploiement, copiez le secret du webhook **Ingest** et définissez :

```bash
OPENLDR_CE_URL=https://your-host        # base URL of the CE deployment
OPENLDR_CE_WEBHOOK_TOKEN=<the-secret>   # the Ingest webhook secret you copied
OPENLDR_CE_TIMEZONE=+03:00              # UTC offset for DISA's unzoned timestamps (per country)
# OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest  # optional — this is already the default
```

`OPENLDR_CE_TIMEZONE` est **obligatoire** et n'a pas de valeur par défaut sûre. DISA enregistre les heures locales sans fuseau horaire, donc un décalage omis déplacerait en silence chaque horodatage clinique. Réglez-le selon le pays du déploiement (Tanzanie `+03:00` ; Mozambique/Zambie `+02:00`).

> **Le webhook veut un Bundle ou un tableau, mais pas la CLI.** La branche FHIR du webhook `ingest` accepte un **Bundle** de transaction ou un simple **tableau** de ressources. La **CLI** `openldr ingest` ci-dessous est plus stricte : elle prend un **Bundle** FHIR (ou une seule ressource), pas un tableau. Envoyez chaque contenu vers la voie qui correspond à sa forme.

Si vous avez simplement un fichier Bundle, `openldr ingest bundle.json` (ci-dessous) est la voie clé en main. Elle applique le même convertisseur et le même contrôle de validation sans créer de flux de travail.

## 2. Charger un fichier avec la CLI (toute installation)

`openldr ingest <file>` lit un fichier, le convertit et écrit les résultats dans le magasin FHIR. Le **convertisseur** décide comment le fichier est lu :

```bash
# A FHIR Bundle (the default converter)
./openldr ingest data/bundle.json

# A WHONET SQLite export, via a converter plugin (install the plugin first)
./openldr ingest data/whonet.sqlite --plugin whonet-sqlite

# A CSV with a column mapping
./openldr ingest data/results.csv --plugin tabular --config data/mapping.json
```

Ces formes sont celles de la pile installée : chaque fichier se trouve dans `./data` et porte le préfixe `data/`. Depuis une copie des sources, utilisez `pnpm openldr` et les chemins ordinaires de l'hôte. Les plugins convertisseurs fournis sont des fichiers du dépôt. Leur installation se fait donc depuis une copie des sources :

```bash
pnpm openldr ingest bundle.json
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest whonet.sqlite --plugin whonet-sqlite
pnpm openldr ingest results.csv --plugin tabular --config mapping.json
```

Une exécution réussie affiche `batch <id>: done (<n> resources)`. **0 resources** signifie que le convertisseur n'a pas reconnu le fichier. Examinez ou relancez un lot avec les commandes `pipeline status` et `pipeline retry <batchId>`. Convertisseurs livrés avec OpenLDR : `fhir-bundle` (par défaut), `whonet-sqlite`, `hl7v2` et `tabular`. D'autres peuvent être ajoutés comme plugins de la marketplace.

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

## 3. Synchronisation distribuée (laboratoire ↔ central, pas pour les tiers)

Si cette instance est un **laboratoire** inscrit auprès d'un serveur OpenLDR **central**, ses données remontent automatiquement par le canal de synchronisation (`POST /api/sync/push`, authentifié par les identifiants machine du laboratoire). Il s'agit uniquement de réplication laboratoire↔central : un système tiers ne peut pas y envoyer de données. Voir le guide **Synchronisation distribuée** dans l'application.

## Où vont les données

Les ressources ingérées arrivent dans le magasin FHIR interne et sont projetées dans l'entrepôt analytique que lisent les rapports et les tableaux de bord. Si des données sont ingérées mais n'apparaissent pas dans un rapport, vérifiez que le stockage cible est configuré (voir [Variables d'environnement](/docs/environment)) et laissez un moment à la projection pour rattraper son retard.

### Faits et attributs des demandes

Chaque demande de laboratoire porte, quand la source les envoie : l'ensemble OBR, l'heure d'analyse, le lieu de soins, le type de demande, qui l'a enregistrée et analysée, le médecin demandeur, l'âge au moment de la demande, les informations cliniques, l'analyseur, ainsi que le code et le motif de rejet. Chaque compte rendu porte sa section et la personne qui l'a validé.

Les faits plus rares sont des lignes de `lab_request_attributes`, une ligne par demande et par attribut. Les codes d'attribut forment le système de codes `urn:openldr:cs:request-attribute`. Chargez-le une fois avec :

    openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

Lancez cette commande depuis une copie des sources du dépôt OpenLDR CE, où le fichier se trouve à ce chemin. Sans l'importation, les lignes d'attribut sont quand même enregistrées. Seuls les libellés des codes manquent.

Un fait que la source n'envoie pas reste vide. Rien n'est complété.

Un résultat numérique hors de la plage de rendu du laboratoire arrive sous forme de limite avec un comparateur, par exemple `< 20`. `lab_results.numeric_comparator` contient `<`, `<=`, `>=` ou `>`, et reste vide pour un nombre ordinaire. Dans ce cas, `numeric_value` contient la limite.

Chaque résultat porte son statut FHIR dans `lab_results.status`. Un examen rejeté à la saisie du résultat est enregistré comme une ligne de statut `cancelled`, sans valeur, avec le motif dans `data_absent_code` et `data_absent_reason`, par exemple `HAEM` et `Haemolysed`. Pour compter les résultats, ajoutez `(l.status is null or l.status <> 'cancelled')` à la requête. Pour compter les examens rejetés, utilisez `l.status = 'cancelled'`. Qualifiez `status` avec l'alias de lab_results, car lab_requests, specimens et diagnostic_reports ont aussi une colonne `status`. Une ancienne requête qui les joint et utilise `status` seul doit être qualifiée. Une installation mise à niveau depuis une version antérieure n'a pas de statut sur les lignes qu'elle contenait déjà. Lancez `openldr db reproject --force` une fois après la mise à niveau pour les remplir.

`clinical_info` est masqué par défaut dans le concepteur de tableaux de bord, car il peut contenir du texte libre ou un id patient pseudonyme. Affichez-le dans Paramètres, puis Exposition des données. La table `lab_request_attributes` n'apparaît pas du tout dans le concepteur de tableaux de bord. Lisez-la avec des requêtes personnalisées.
