# Deployment & developer docs

This in-app manual covers tasks you perform inside the app as a signed-in user.
Deployment, configuration, and developer topics live on the **OpenLDR website**, in its
Docs section:

- **Requirements & Install** — what you need and the one-line installer (including a
  public domain with a trusted Let's Encrypt certificate).
- **Environment variables** — every value in the deployment's `.env`.
- **Windows Server (WSL2)** — deploying on Windows Server via WSL2.
- **Development** — running OpenLDR from source with hot reload.
- **Command-line interface (CLI)** — the `openldr` operator command line (database,
  terminology, ingest, plugins, reports, users, marketplace).
  - **`openldr db reproject --force`** rebuilds the entire warehouse read model from the
    canonical FHIR store, including the `ingest_events` arrival ledger. It refuses without
    `--force` because it rewrites every projected row.
  - **`openldr terminology reproject` is deprecated** and does exactly the same thing. It
    always did — despite its name it never rebuilt only `terminology_codes`. Use
    `db reproject`.
  - **`ingest_events` is the record of when data reached OpenLDR.** One row per arrival of
    each clinical resource, keyed on resource and version, rebuilt from the canonical
    store. The `created_at` column on `lab_requests`, `specimens` and the other projected
    tables is **not** an arrival time: it records when the projection first wrote that row,
    it holds exactly one timestamp however many times the resource is later corrected, and
    it is reset for any row that has to be re-inserted. Anything asking "when did this
    reach us" must read `ingest_events`.

You'll find all of these on the project website and in the source repository:
<https://github.com/Open-Laboratory-Data-Repository/openldr>.

## Request facts and request attributes

Each lab request carries, where the source sends them: the OBR set, analysis time, point of care,
request type, who registered and tested it, the requesting doctor, age at the request, clinical
information, analyser, and rejection code and reason. Each report carries its section and who
authorised it.

Rarer facts are rows in `lab_request_attributes`, one row per request and attribute. The attribute
codes are the `urn:openldr:cs:request-attribute` coding system. Load it once with:

    openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

Run this from a source checkout of the OpenLDR CE repository, where the file lives at that path.
Without the import, attribute rows are still stored. Only the code display names are missing.

A fact the source does not send stays empty. Nothing is filled in.

A numeric result outside the lab's reporting range arrives as the limit with a comparator, for
example `< 20`. `lab_results.numeric_comparator` holds `<`, `<=`, `>=` or `>`, and is empty for an
ordinary number. `numeric_value` holds the limit in that case.

`clinical_info` is hidden from the dashboard builder by default, because it can hold free text or
a pseudonymous patient id. Unhide it in Settings, then Data Exposure. The `lab_request_attributes`
table is not in the dashboard builder at all. Read it with custom queries.

## Related guides

- [Start Here](/docs/start-here)
- [Settings](/docs/settings)

## Projection retries

The projection worker saves failed resource writes and arrival-ledger writes for automatic retry.
Retries survive a restart and reread the current canonical resource, including deletions.
A cycle retries at most 100 queued resources, then handles new changes.
Repeated failures wait 1, 2, 4 seconds and so on, up to five minutes.
Retries continue until successful; a failing resource does not hold later valid changes.
A new change to that resource can trigger an attempt before the delay expires.
If saving a retry fails, the worker leaves its cursor unchanged.
Successful projection clears the retry. Ancillary capture-hook errors are logged without scheduling retries.
No operator action is required after a temporary outage clears.
For a deliberate full rebuild, use `openldr db reproject --force`.
