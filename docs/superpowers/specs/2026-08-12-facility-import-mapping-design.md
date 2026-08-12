# Facility import — map the file to the contract, inside the app

An operator is handed a national facility list. Its columns and its vocabulary are not ours. Today
they need someone who can read the codebase to bridge the gap. This makes the import do it.

Triggered by the Zambia MFL export
(`mfl_facilities_export20260810155748.xlsx`, 3788 rows, 21 columns), mapped by hand in a session on
2026-08-12. Every number below is measured from that file.

## Why

The import contract is country-agnostic and documented as "whoever obtains a national list maps
their columns onto these once" — `packages/terminology/src/facility-csv.ts:5`. That sentence is the
whole problem. **There is nowhere in the app to do the mapping.** The operator does it in a
spreadsheet, or not at all.

Measured against the Zambia file:

| | Count |
|---|---|
| Columns the contract accepts by name | 11 of 21 |
| Columns with no home unless carried to `extras` | 9 |
| Fields with no source column at all (`country`) | 1 |
| `Type` values needing a vocabulary decision | 19, against a 63-code list |
| `Operational status` values | 4, against 3 |

Two failure modes follow, and both are silent.

**A refused file.** Unknown columns fail the whole import rather than being dropped
(`facility-csv.ts:166`). That is correct and must stay — but the operator's only recourse today is a
checkbox that sends every unrecognised column to `extras` wholesale, with no chance to say "`Province`
is our `zone`".

**A silently unmapped vocabulary.** An unmapped `level`/`status` value is never blocked and never
blanked; the raw string is written through and merely counted
(`packages/bootstrap/src/facility-controlled-fields.ts:155`). The import reports success. The
facility list then reads `Functional` where the rest of the app expects `active`.

## What was checked first

RULE 0 pass. Four premises, two of which changed the design.

| Premise | Finding |
|---|---|
| Ward needs a new column | **False.** `ward` already exists on `facility_registry` (`packages/db/src/migrations/internal/070_facility_registry.ts:27`), in the CSV contract (`facility-csv.ts:10`), and in `CORE_FACILITY_KEYS` (`packages/db/src/facility-answers.ts:22`). Only the *form* lacks the field, and that is a form-builder edit. Nothing here needs a migration for it. |
| Value mappings cannot be authored today | **False, but barely.** `termMappings.create` takes `fromSystem`/`fromCode` directly (`packages/db/src/terminology-admin-store.ts:709`), the coding-system URL is operator-typed (`apps/studio/src/terminology/CodingSystemDialog.tsx:143`), and terms can be created into it (`apps/studio/src/terminology/TermDialog.tsx:263`). So the path exists. It requires hand-typing a derived URL — see the next row. |
| The derived source URL is a minor inconvenience | **Confirmed as the worst thing in the flow.** `observedFieldSystem` builds `urn:openldr:cs:facility-<field>:<slug>`, lowercasing and collapsing non-alphanumeric runs to `_` (`facility-controlled-fields.ts:60`). Resolution is an exact string lookup. A typo produces no error — the mappings simply never resolve, and the import reports success. This is why value mapping belongs in the wizard, which knows the register url and can derive the slug itself. |
| A column map needs a new table | **False.** `facility_import_runs.options` is `jsonb` (`080_facility_import_runs.ts:41`) and the worker already spreads a run's stored options into the apply. A per-file column map rides there. **No migration in this slice.** |

## Scope

**In.** Column mapping, constants, explicit `extras` opt-in, ranked suggestions, and value mapping
for the three controlled fields — all inside the import wizard, plus CLI equivalents.

**Out, deliberately.**

- **Renaming the admin-level labels.** The Facilities page filters read `Zone`/`Region`/`District`/
  `Council` from fixed i18n keys (`apps/studio/src/pages/Facilities.tsx:855`), not from the form's
  `displayLabel`. A Zambian operator maps Province → Zone correctly and still sees "Zone" afterwards.
  Operator decision on 2026-08-12: deferred.
- **xlsx input.** The importer takes `.csv`/`.jsonl` (`ImportFacilitiesSheet.tsx:1260`). Converting is
  a ten-second job with its own risks (merged cells, multiple sheets, formatting-as-data).
- **Shareable mapping profiles.** Map Zambia MFL once, ship it, others install it. Wanted, and the
  natural follow-up — a profile is just the saved output of this slice. Needs a check that the
  marketplace can carry this content type. Not now.
- **Any model call.** These labs are offline. The suggestion engine is shipped code or it is nothing.

## Design

### 1. The column map

A per-file value carried in the import request and stored in the run's `options`.

```json
{
  "columns": {
    "MFL Code": "national_code", "Name": "name", "Province": "zone",
    "District": "district", "Constituency": "council", "Ward": "ward",
    "Type": "level", "Operational status": "status", "Ownership": "ownership",
    "Latitude": "latitude", "Longitude": "longitude"
  },
  "constants": { "country": "ZMB" },
  "extras": ["DHIS2 UID", "Hims code", "Location", "Mobility status", "Accesibility",
             "Catchment population head count", "Catchment population cso",
             "Number of households", "Zone"]
}
```

**Every header must appear in exactly one of `columns` or `extras`.** That preserves today's
safety property — nothing is silently dropped — while giving the operator a way to say where each
column goes. A header in neither is `unknownColumns`, and the file is refused exactly as now.

`constants` fills a field the file does not have. `country` is the case that forced it: the Zambia
sheet has no country column, and the bound value set is ISO 3166-1 **alpha-3**
(`073_facility_country_and_admin_fields.ts:49`), so the value is `ZMB`, never `Zambia`.

A column sent to `extras` keeps today's key: the header **lowercased and trimmed**
(`facility-csv.ts:205`), so the sheet's `Accesibility` misspelling survives but its casing does not.
This is existing behaviour for every register already imported, and changing it would silently
re-key their `extras`. The column map's own keys are the headers **as they appear in the file**, so
the operator matches what they see; the parser lowercases them for lookup.

### 2. Applied in the parser

`parseFacilityCsv(input, { columnMap, constants, … })` renames headers before it validates.

Chosen over rewriting the file into canonical headers first, for two reasons. A pre-transform holds
the whole file in memory, which is wrong for the 64 MiB streamed upload path. And it puts constants
somewhere the parser's own error reporting cannot see — a constant colliding with a mapped column
would be invisible.

Everything downstream is untouched: classification, the write, the samples, quarantine, and the
`text()` trim that already strips the 402 padded names and the trailing space on
`Temporarily closure ` (`facility-csv.ts:114`).

### 3. Refusals

Each of these fails the file rather than guessing. The reasoning is the existing
`duplicateColumns` rule: which column wins is a guess about master data.

| Condition | Why it cannot be resolved automatically |
|---|---|
| A header in neither `columns` nor `extras` | Today's `unknownColumns` behaviour, unchanged |
| Two headers mapped to the same field | Which one is authoritative is unknowable |
| A constant naming a field a column also maps | Same |
| `national_code` or `name` unmapped | Required by the contract (`facility-csv.ts:7`) |
| A mapped target outside the contract's field list | Typo, or a field that does not exist |

### 4. The suggestion engine

Lives in `@openldr/bootstrap` so the route and the CLI call identical code. Pure and
dependency-free, so it is cheap to test exhaustively.

Normalise both sides — lowercase, strip non-alphanumerics, collapse whitespace. Then, in order:

1. **Exact** normalised match. `MFL Code` → `national_code` via the synonym table; `Name` → `name`
   directly.
2. **Synonym table**, curated and shipped. `province`/`state` → `zone`, `county` → `region`,
   `woreda` → `district`, `facility type` → `level`, `operational status` → `status`.
3. **Similarity** on character bigrams, above a threshold.
4. **Nothing.** The operator picks.

The same matcher serves value suggestions, with candidates drawn from the bound value set's
expansion — 63 for `level`, 3 for `status`, 249 for `country` — matching against both code and
display.

**Confidence is shown, never hidden.** Exact matches are pre-selected silently. Similarity matches
are pre-selected and badged for checking. Weak and absent matches pre-select nothing. **No import
proceeds while any required field is unmapped**, so a bad guess cannot ride through unnoticed.

This is where the honesty of the design sits. On the Zambia file the matcher gets `Health Centre` →
`health-center` and `Health Post` → `health-post` outright, and gets **nothing** for
`1st Level Hospital` → `district-hospital`, which needs knowledge of how Zambia tiers its hospitals.
Offering a weak guess there would be worse than offering none.

Measured expectation for that file, counted rather than estimated:

- **10 of 21 columns** suggested without a keystroke — six exact (`Name`, `District`, `Ward`,
  `Ownership`, `Latitude`, `Longitude`) and four from the synonym table (`MFL Code`, `Province`,
  `Type`, `Operational status`).
- **9 columns** the operator sends to `extras` in one action.
- **2 columns** needing a real decision: `Constituency` → `council` is a judgement call, and the
  sheet's own `Zone` column is junk — 117 rows carrying the single value `Chamakubi Zone`.
- On `Type`, the two values covering **3363 of 3788 rows** (`Health Centre`, `Health Post`) match
  outright. The rest range from moderate (`Mobile clinic` → `mobile-medical-clinic`) to nothing at
  all, including four genuinely ambiguous pairs (`1st`/`2nd`/`3rd Level Hospital`, `Dental clinic`).

Row coverage matters more than distinct-value coverage here, and it is the honest number to report
to the operator: the panel should say how many *facilities* a mapping decision affects, not how many
strings.

### 5. Value mapping

The preview already computes every unmapped `level`/`status`/`country` value and the wizard already
displays them as a warning (`ImportFacilitiesSheet.tsx:452`). This turns that warning into a panel
where each value gets a ranked pick-list.

The writer is `termMappings.saveExclusive` (`terminology-admin-store.ts:199`), which enforces one
active mapping per `(from_system, from_code)` within a `(to_system, map_type)` scope, in a single
transaction.

⛔ **Pin one `mapType` for all controlled-field mappings.** `resolveControlledFields` reads
`listOutgoing(fromSystem, raw)` and takes the first active row, **ignoring `toSystem` entirely**
(`facility-controlled-fields.ts:133`). `saveExclusive`'s exclusivity is scoped by
`(to_system, map_type)`. So two mappings written under different scopes would both stay active and
resolution would pick between them arbitrarily. One pinned `mapType` makes the store's exclusivity
and the resolver's lookup agree. **The plan must name that constant explicitly and put it in one
place**, shared by the route, the CLI, and any future profile importer.

**Also create the source coding system and its concepts, as drafts.** `term_mappings` does not
require the source concept to exist, so the wizard could skip this. It should not: a mapping with no
source term is invisible in Settings → Terminology and therefore uneditable afterwards. Creating
them mirrors what `termMappings.create` already does for a missing *target*
(`terminology-admin-store.ts:724`), and gives a future profile something to export.

### 6. Flow

```
pick file + register source
        │
        ▼
  header + suggestions  ──── one endpoint, both doors
        │
        ▼
  operator confirms the column map
        │
        ▼
      preview ──────────────► unmapped values?
        │                            │ yes
        │ no                         ▼
        │                   map values → write term_mappings
        │                            │
        │                            ▼
        │                       re-preview
        ▼                            │
      confirm ◄──────────────────────┘
        │
        ▼
       apply
```

One endpoint returns the header row plus ranked suggestions, and both import doors call it. The
inline path already holds the file text client-side (`ImportFacilitiesSheet.tsx:563`); the streamed
path does not, since the file is a blob only the server can read. Building the suggestion step once,
server-side, avoids two mechanisms that would drift.

⚠ **Value mapping costs a second pass over the file.** The preview must re-run for the newly written
mappings to resolve. On 3788 rows that is nothing. On a 130 000-row register through the streamed
path it is a second background validate. That is the price of showing the operator real values
instead of guesses, and it is stated here so it is not discovered late.

### 7. CLI parity

§6 requires it, and labs run headless. Today's command has no mapping surface at all
(`packages/cli/src/facilities.ts:55`).

```
openldr facilities suggest-map <path> --national-system <sys>
openldr facilities import <path> --national-system <sys> --column-map <file.json>
openldr facilities suggest-values <path> --national-system <sys>
openldr facilities import <path> --national-system <sys> --value-map <file.json>
```

`suggest-map` prints the ranked suggestions as the column-map JSON, ready to edit and feed back to
`--column-map`. The suggestion engine and the mapping writer are the same `@openldr/bootstrap`
functions the routes call. Never duplicated.

⚠ The CLI's `--national-system` remains free text — the HTTP doors are gated by a registered-source
lookup and the CLI is not (`facility-csv.ts:103`). This slice does not close that; it must not widen
it either. A `--value-map` writes under `observedFieldSystem(field, <whatever was typed>)`, so a
mistyped register on the CLI writes mappings that will never resolve. Documented, not fixed here.

## Error handling

- Refusals list **every** problem at once, with the offending header or value quoted, so the operator
  fixes one file rather than discovering faults one at a time.
- An unmapped *value* never blocks. Existing behaviour, and it is right: the raw string writes
  through and the count is reported (`facility-controlled-fields.ts:155`).
- An unmapped *required column* always blocks. A file with no `name` is not a facility list.
- A value mapping whose target is not in the value set is refused by validating against the value
  set's own expansion **before any write**, so a half-applied set is impossible.

  ⛔ **Do not lean on the store's `draftCreated: true` for this.** As built, that signal turned out
  to be unusable: `saveExclusive` looks for the target concept at `(toSystem, toCode)`, and passing
  the field's **ValueSet** url — which is not where concepts are filed — made the lookup miss on
  every call, so `draftCreated` was unconditionally true and meant nothing. The target's system now
  comes from the value set's own expansion (each expanded concept carries its `system`), so mappings
  file under the real coding system and no orphaned draft is minted. Found in review of Task 5,
  fixed in `e3eceb56`.

## Testing

| Layer | What it proves |
|---|---|
| Matcher unit tests | Normalisation, synonym hits, similarity thresholds, and — most importantly — that `1st Level Hospital` yields **no** suggestion. Pure functions, exhaustive, fast. |
| Parser tests | Each refusal above; a constant applied to every row; `extras` carrying exactly the opted-in columns. |
| Zambia fixture | The real file, trimmed to a committed sample. Asserts 3788 records, `country: 'ZMB'` on all, 9 columns in `extras`, and 0 rows lost to the 98 blank coordinate pairs. |
| Route tests | The wire shape of the suggestion endpoint. `typecheck` does not pin this; only a route test does. |

⚠ **pg-mem is not Postgres.** The value-mapping write and `resolveControlledFields` both need real
`term_mappings` behaviour. Mark those tests Postgres-only, as the external-migration tests already
are, and say so in the plan.

**HONEST NON-PROOF.** No test here proves an operator reads the confidence badges the way we intend,
or that the suggestion ranking is *useful* rather than merely correct. Only watching someone map an
unfamiliar national list start to finish would show that. The Zambia file is the obvious candidate,
and the person who has it should drive it.

## What this does not fix

- The Facilities page still labels the admin levels `Zone`/`Region`/`District`/`Council`.
- `region` has no Zambian source and stays empty, so the form field must be made optional by hand —
  it is `required: true` today (`073_facility_country_and_admin_fields.ts:409`).
- `Ward` and `Ownership` still need adding to the Facility form in the form builder. Both are already
  real columns; neither needs code.
- 23 Zambian facilities keep raw `Type` values, because five of the 19 types have no target in the
  63-code list: First-aid stations (8), Others (7), Rehabilitation centre (3), Hospice (3), Fertility
  clinic (2).
