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

## Related guides

- [Start Here](/docs/start-here)
- [Settings](/docs/settings)
