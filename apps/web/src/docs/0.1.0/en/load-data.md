# Load & push data

Once OpenLDR is running, you need to get lab data into it. OpenLDR has **no generic FHIR
ingest endpoint** — there is no `POST /fhir` you can send resources to. Data comes in through
one of the paths below. Which one you use depends mostly on how you installed.

> **Where's the `openldr` CLI?** Both install types have it. The one-line Docker installer
> writes an `openldr` wrapper into the install directory — run it there as `./openldr …`
> (`.\openldr.ps1` on Windows). From a clone of the repository, run `pnpm openldr …` instead.
> You do not need the CLI to get started either way: the installer sets `MIGRATE_ON_START=true`
> and `SEED_ON_START=true`, so the stack migrates and seeds itself on first boot, and the
> **HTTP webhook** below works on any install.
>
> One difference matters for file arguments. The wrapper runs the CLI inside the `api`
> container, which only sees the `data` directory, so put files in `./data` and name them with
> the `data/` prefix. A source checkout uses ordinary host paths. See [the CLI page](/docs/cli).

## 1. Push over HTTP with a workflow webhook (works on any install)

The inbound HTTP path is a **workflow** with a **Webhook** trigger. The request body is handed
to the workflow as its input, and **what gets stored is whatever the workflow does with it** —
so you control the exact shape (a form submission, a vendor payload, or a FHIR Bundle you
normalise inside the workflow).

A fresh install ships **one** ingestion webhook workflow, **Ingest** (`wf-ingest`), that routes
by the **shape** of the posted body. **A fresh install ships it enabled** — hand capture on the
**Forms** page submits through it, so it is install-critical rather than optional. (On an
**upgraded** install it may have been left disabled by an earlier version; see *Upgrading an
existing install?* below.) Its HTTP endpoint is still closed to anyone without the per-install
secret:

| Workflow | Webhook path | Expects | Behavior |
|---|---|---|---|
| **Ingest** | `ingest` | a FHIR transaction **Bundle**, a **bare array** of FHIR resources, or a plain `{…}` object of **form answers** | a **Switch** node checks the shape: Bundle/array → **Unwrap FHIR Bundle** (one item per resource, references resolved); object → **Form Validate** against the seeded "Lab order" form. Both branches persist through the same **Persist / Store** |

To use it:

1. In the app, open **Workflows** and open **Ingest**.
2. On its **Webhook** trigger, **copy the secret**. The trigger has a fixed URL path (`ingest`)
   and a per-install secret generated at seed time.
3. Send the payload from your external system:

```bash
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: <the-webhook-secret>" \
  -d @order.json
```

**Security:** the secret is sent in the `X-Webhook-Token` header and checked in constant time on
the server. Always POST over **HTTPS** so the token isn't exposed, treat the secret like a
password, and rotate it by editing the workflow's webhook trigger. A wrong or missing token is
rejected with `401`; an unknown path returns `404`.

You can also build your own webhook workflow (**Webhook → transform/validate → Persist / Store**)
for any other payload shape — **Ingest** just covers the common cases out of the box.

> **Upgrading an existing install?** Workflows are seeded by id and never overwritten, so an
> upgrade keeps the `wf-ingest` row you already have — including your edits to its graph.
>
> - **Enabled state.** Earlier versions shipped `wf-ingest` **disabled**. Because hand capture now
>   submits through it, a disabled `wf-ingest` would make every form submission fail with
>   *"capture pipeline unavailable"*. The server therefore **enables it for you on startup** if it
>   finds it disabled — a one-flag change that leaves your node graph, name and webhook secret
>   untouched. Nothing else about the workflow is re-seeded. If you genuinely want it off, you
>   must also stop using hand capture, since the two cannot be separated.
> - **Your edits.** A customised `wf-ingest` graph is never overwritten by an upgrade. If you need
>   the shipped graph back, use **Reset to default** on the workflow's ⋯ menu.
> - **Retired workflows.** On a deployment that predates the unified wiring, the old
>   `wf-ingest-form` / `wf-ingest-raw` remain (disabled) and can be deleted manually, and the
>   pre-existing reactive companion keeps listening on the old event source.

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

```bash
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

## 2. Load a file with the CLI (any install)

`openldr ingest <file>` reads a file, converts it, and writes the results into the FHIR
store. The **converter** decides how the file is parsed:

```bash
# A FHIR Bundle (the default converter)
./openldr ingest data/bundle.json

# A WHONET SQLite export, via a converter plugin (install the plugin first)
./openldr ingest data/whonet.sqlite --plugin whonet-sqlite

# A CSV with a column mapping
./openldr ingest data/results.csv --plugin tabular --config data/mapping.json
```

Those are the installed-stack forms, so every file sits in `./data` and carries the `data/`
prefix. From a source checkout, use `pnpm openldr` and ordinary host paths. The bundled
converter plugins are repository files, so installing one is a source-checkout command:

```bash
pnpm openldr ingest bundle.json
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest whonet.sqlite --plugin whonet-sqlite
pnpm openldr ingest results.csv --plugin tabular --config mapping.json
```

A successful run prints `batch <id>: done (<n> resources)`. **0 resources** means the converter
did not recognise the file. Inspect or retry a batch with the `pipeline status` and
`pipeline retry <batchId>` commands. Converters that ship with OpenLDR: `fhir-bundle`
(default), `whonet-sqlite`, `hl7v2`, and `tabular`; more can be added as marketplace plugins.

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
