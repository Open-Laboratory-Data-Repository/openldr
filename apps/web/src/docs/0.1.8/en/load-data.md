# Load & push data

<!-- operator-platform -->

Run maintenance on the OpenLDR host, from your installed Compose folder. The examples use `~/Downloads/openldr_ce` on Linux/macOS and `C:\openldr_ce` in PowerShell. Replace these paths with your installation. The blue prompt is already shown by the terminal. Type the command only. File illustrations show text to edit in the named file. Pictures are examples, not proof that maintenance succeeded. Sample data is optional.

## Find a workflow

Use this to open an existing definition before inspecting or changing it.

### 1. Open Workflows

Select **Workflows** in the main menu.

![Open Workflows from the main menu.](/docs-images/operator/workflows-guide-open-page.png)

### 2. Find the workflow

Use **Search workflows** to filter names. Clear the search to restore the list.

![Search filters the workflow names.](/docs-images/operator/workflows-guide-search.png)

### 3. Open its row

Select the workflow name. This example opens the shipped **Ingest** workflow.

![Open the shipped Ingest workflow.](/docs-images/operator/workflows-guide-ingest-row.png)

### 4. Fit the canvas

Select **Fit View** at the bottom left. Use the plus and minus controls to zoom. Pan moves the canvas; Select draws a selection box.

![Fit view brings the nodes into the canvas.](/docs-images/operator/workflows-guide-fit.png)

## Set the Ingest webhook secret

Use this when an authorised sender needs a credential you can copy. A saved secret cannot be revealed. Coordinate rotation with the senders first.

### 1. Select Ingest received

Select the first node, **Ingest received**.

![Select the webhook trigger Ingest received.](/docs-images/operator/workflows-guide-trigger.png)

### 2. Open its settings

Select the gear labelled **Configure** above the selected node.

![Configure opens the selected node settings.](/docs-images/operator/workflows-guide-configure.png)

### 3. Generate a new secret

Under **Secret**, select **Replace secret**. An unsaved value instead offers **Regenerate**.

![Replace secret generates a value you must copy before saving.](/docs-images/operator/workflows-guide-replace-secret.png)

### 4. Copy the new value

Copy the new secret and keep it with your sender credentials. The URL and Header fields show where and how to send it.

![Copy the new secret before saving. The saved value cannot be revealed.](/docs-images/operator/workflows-guide-copy-secret.png)

### 5. Save the workflow

Select **Save** in the toolbar.

![Save stores the workflow and its new secret.](/docs-images/operator/workflows-guide-save.png)

### 6. Confirm the system change

Check the system-workflow warning, then select **Save anyway** when you intend the change.

![System workflows require an explicit Save anyway confirmation.](/docs-images/operator/workflows-guide-confirm-save.png)

**Expected result:** The Workflow saved message confirms the write. Senders must use the newly saved secret.

![The workflow saved message confirms this write.](/docs-images/operator/workflows-guide-saved.png)

## Send your payload over HTTPS

Use the saved webhook URL and secret. Ingest accepts a FHIR Bundle, a resource array or supported form answers. A CLI file import accepts a Bundle or single resource, not that raw array. There is no generic POST /fhir ingest endpoint. Put your approved payload in data/your-payload.json.

### 1. Post with the saved secret and a request key

Replace host, saved secret and request key. Each new logical request needs its own key. Retries of that same request use the same key and same body. Never expose the secret in a public screenshot. Sending writes data according to the workflow; run only when intended.

```sh
{{operator:data-post}}
```

![Post with the saved secret and a request key.](guide:operator-data-post)

### 2. Poll an accepted request until it finishes

HTTP 202 means accepted, not completed. Use the response statusUrl or replace REQUEST_ID here. The saved secret is required to poll. A completed run can return HTTP 200; 500 means failure, and interrupted or cancelled receipts return 409. Investigate uncertain effects before resubmitting. Missing/wrong secrets return 401 and unknown paths return 404.

```sh
{{operator:data-poll}}
```

![Poll an accepted request until it finishes.](guide:operator-data-poll)

### 3. Inspect the recorded receipt on the host

Replace REQUEST_ID. History in Studio also separates receipts from runs. A queued or running receipt has not completed. Disabling or changing a workflow can cancel queued work. Do not bulk retry with new keys.

```sh
{{operator:data-receipt}}
```

![Inspect the recorded receipt on the host.](guide:operator-data-receipt)

## Load a file through the installed CLI

Use your own valid FHIR JSON. Put it in the installation’s shared data folder. From a development checkout use pnpm openldr and ordinary host paths. Starter dashboards and sample data are optional; essential ingestion definitions remain available without them.

### 1. Validate the file without importing it

Validation is not ingestion. Correct reported errors first. A missing file often means it is outside data or the path lacks its data/ prefix.

```sh
{{operator:data-validate}}
```

![Validate the file without importing it.](guide:operator-data-validate)

### 2. Import when ready to write

This writes into the configured installation. A successful run reports a batch and resource count. Zero resources is not useful proof of an import. Check the converter and source format.

```sh
{{operator:data-ingest}}
```

![Import when ready to write.](guide:operator-data-ingest)

### 3. Read the batch status

Find the batch ID printed by ingestion. The API worker may finish it asynchronously. A pending batch is not a completed import.

```sh
{{operator:data-status}}
```

![Read the batch status.](guide:operator-data-status)

### 4. Inspect errors before retrying

Replace BATCH_ID. Read the error and correct its cause before choosing pipeline retry. Stored FHIR resources project into the analytics warehouse; dashboard appearance also depends on projection and query filters.

```sh
{{operator:data-logs}}
```

![Inspect errors before retrying.](guide:operator-data-logs)

## Use an approved converter when needed

FHIR is the default. Other formats need the appropriate converter and configuration. Use an approved signed plugin in normal operation. The examples below are alternatives, not required sample files.

### 1. Install the approved plugin file

Replace the example filename with your approved artifact, placed in data. Development builds in reference-plugins are source-checkout files, not paths assumed to exist in an installed stack.

```sh
{{operator:data-plugin}}
```

![Install the approved plugin file.](guide:operator-data-plugin)

### 2. Select its identifier for ingestion

Replace source filename and PLUGIN_ID. Use the plugin’s documented mapping/configuration options. Review the batch afterward with the earlier status and log commands.

```sh
{{operator:data-plugin-ingest}}
```

![Select its identifier for ingestion.](guide:operator-data-plugin-ingest)

## Optional payload examples

### Example payloads

**`bundle.json`** — the default `fhir-bundle` converter takes a FHIR `Bundle` (it reads each
`entry.resource`) or a single bare resource. A **clinically complete lab submission** — a patient,
the **order** (`ServiceRequest`), and the **result** (`Observation`) linked back to that order:

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

> A **bare JSON array** of resources is *not* a Bundle and will not persist — wrap resources in
> a `Bundle` as above, or post a single resource object.

> **Validation strictness.** Front-door pushes are validated at the configured level (**default
> High**, in **Settings → Danger Zone → Data validation**, or `openldr settings validation`). At
> High, a **laboratory result** (an `Observation` with `category` code `laboratory`, or a `LAB`
> `DiagnosticReport`) **must reference its order** via `basedOn` — the `ServiceRequest` must be in
> the same batch or already stored — or the **whole submission is rejected** with a `422` and an
> `OperationOutcome` listing what's missing. That's why the example above includes the
> `ServiceRequest` and links the `Observation` to it. Lower the level to `medium` (order present but
> not resolved) or `low` (structure only) if you must, but High is the safe default for lab data.

**`results.csv` + `mapping.json`** — the `tabular` plugin turns rows into FHIR. Its `--config`
is a JSON file with an `output` (`fhir` or `rows`) and a `mapping` that tells the plugin which
columns become which FHIR fields:

```
mrn,sex,dob,test,value,unit
MRN-001,female,1990-05-01,Hemoglobin,13.5,g/dL
```

The exact `mapping` keys are defined by the tabular plugin and are also editable from its node
in **Workflows** (the same plugin backs the workflow **Tabular** node), so you can build and
preview a mapping in the app before saving it as `mapping.json`.

## CDR sender settings

### Post pre-built FHIR (the CDR toolchain)

The **Ingest** workflow's FHIR branch is the front door for a system that already emits FHIR
resources — most notably the **CDR toolchain**, which posts a **FHIR transaction Bundle**. Current
CDR toolchain versions **default** their target path (`OPENLDR_CE_HOOK_PATH`) to the unified
webhook (`/api/workflows/hooks/ingest`), so no path config is needed out of the box. An **older
toolchain — or one whose `.env` still pins the retired `cdr-ingest` path** — must set
`OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest` (the **full** path, not bare `ingest`) to target
it. The pipeline is **Webhook → Switch → Unwrap FHIR Bundle → Persist / Store → Log**:

- The request body is a **FHIR transaction Bundle** (or a bare array of FHIR resources). **Unwrap
  FHIR Bundle** resolves internal references and unwraps it into **one item per resource**,
  because **Persist / Store persists one FHIR resource per input item** — the same write path
  (and **validation strictness gate**) the CLI uses.
- **One webhook handles tests and questionnaires together.** Persist stores every resource, and the
  projection routes each by `resourceType` (`Observation` → `lab_results`, `ServiceRequest` →
  `lab_requests`, `QuestionnaireResponse` → `questionnaire_responses`, …).

To point the CDR toolchain at a deployment, copy the **Ingest** webhook secret and set:

**`CDR toolchain .env`**

```dotenv
OPENLDR_CE_URL=https://your-host        # base URL of the CE deployment
OPENLDR_CE_WEBHOOK_TOKEN=<the-secret>   # the Ingest webhook secret you copied
OPENLDR_CE_TIMEZONE=+03:00              # UTC offset for DISA's unzoned timestamps (per country)
# OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest  # optional — this is already the default
```

`OPENLDR_CE_TIMEZONE` is **required** and has no safe default: DISA stores local wall-clock times
with no zone, so an omitted offset would silently shift every clinical timestamp. Set it to the
deployment's country (Tanzania `+03:00`; Mozambique/Zambia `+02:00`).

> **A Bundle or array is what the webhook wants — but not what the CLI wants.** The `ingest`
> webhook's FHIR branch accepts a transaction **Bundle** or a bare **array** of resources. The
> `openldr ingest` **CLI** below is narrower: it takes a FHIR **Bundle** (or one bare resource),
> not an array. Send each payload to the path that matches its shape.

If you just have a Bundle file, `openldr ingest bundle.json` (below) is the
turnkey path — it applies the same converter + strictness gate without building a workflow.

## 3. Distributed sync (lab ↔ central, not for third parties)

If this instance is a **lab** enrolled with a **central** OpenLDR server, its data replicates up
automatically over the sync channel (`POST /api/sync/push`, authenticated by the lab's
machine credentials). This is lab↔central replication only — a third-party system cannot push to
it. See the in-app **Distributed Sync** guide.

## Where the data goes

Ingested resources land in the internal FHIR store and are projected into the analytics
warehouse that reports and dashboards read. If data ingests but does not show up in a report,
confirm the target store is configured (see [Environment variables](/docs/environment)) and give
the projection a moment to catch up.

### Request facts and request attributes

Each lab request carries, where the source sends them: the OBR set, analysis time, point of care,
request type, who registered and tested it, the requesting doctor, age at the request, clinical
information, analyser, and rejection code and reason. Each report carries its section and who
authorised it.

Rarer facts are rows in `lab_request_attributes`, one row per request and attribute. The attribute
codes are the `urn:openldr:cs:request-attribute` coding system. Load it once with:

    pnpm openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

Run this from a source checkout of the OpenLDR CE repository, where the file lives at that path.
Without the import, attribute rows are still stored. Only the code display names are missing.

A fact the source does not send stays empty. Nothing is filled in.

A numeric result outside the lab's reporting range arrives as the limit with a comparator, for
example `< 20`. `lab_results.numeric_comparator` holds `<`, `<=`, `>=` or `>`, and is empty for an
ordinary number. `numeric_value` holds the limit in that case.

Each result carries its FHIR status in `lab_results.status`. A test rejected at result entry is stored as a row with status `cancelled`, no value, and the reason in `data_absent_code` and `data_absent_reason`, for example `HAEM` and `Haemolysed`. To count results, add `(l.status is null or l.status <> 'cancelled')` to the query. To count rejected tests, use `l.status = 'cancelled'`. Qualify `status` with the lab_results alias, because lab_requests, specimens and diagnostic_reports also have a `status` column; an older query that joins them and uses a bare `status` needs qualifying. An install upgraded from an earlier version has no status on the rows it already held. Run `openldr db reproject --force` once after upgrading to fill them in.

`clinical_info` is hidden from the dashboard builder by default, because it can hold free text or
a pseudonymous patient id. Unhide it in Settings, then Data Exposure. The `lab_request_attributes`
table is not in the dashboard builder at all. Read it with custom queries.
