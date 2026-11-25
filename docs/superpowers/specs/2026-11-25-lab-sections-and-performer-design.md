# Lab sections from the catalog category, and the performing lab

Date: 2026-11-25. Small project, lab plugin only (batch 3, items A3 and A4). Approved by the operator
on 2026-11-25.

## Why

- A bench works one discipline: the Haematology bench wants its own tests, not every test. Reports
  should say which discipline they belong to. The plugin has no notion of a section today.
- The plugin does not know which facility is the lab, so a report sent to CE names no performer
  (release design 2026-11-24, "not in this slice"). CE's warehouse already reads a report's
  performer (`packages/db/src/relational/diagnostic-report.ts:31`).

## Decisions

- **A section is the test's CE catalog category** (operator, 2026-11-25), not a plugin list. CE seeds
  Chemistry, Haematology, Microbiology, Molecular and Serology (`urn:openldr:valueset:test-category`,
  migration 104); a lab changes them on CE's Terminology page or on the test. The 2026-11-22 lab
  module design's per-lab section list is dropped.
- **The performing lab is one plugin setting**, "This lab's facility", picked from CE's facility
  register (operator, 2026-11-25). Until it is set, reports go without a performer, as today.

## Approaches

- Chosen: the catalog category. No second list to keep in step; all labs share the national list.
- Not chosen: a per-lab section list in the plugin with a section per test. Each lab could differ,
  but it adds a list, a mapping and a screen, and drifts from the catalog.

## Sections

- `order_tests` gains `category` (text, nullable): the catalog category code, copied when the test is
  registered, as its name is (my call: quick filters with no catalog read per row). A test
  registered before this version has none and shows under no section.
- `lab_results_worklist` takes an optional `category` and keeps tests of that category.
- The Orders list gets no Section filter (ruling, 2026-11-25): an order matches through its tests,
  CE's structured filters cannot say "has a test of this category", and reading the matching order
  ids first stops at 1,000 orders without saying so. The bench, which works by section, uses the
  Results and Review tabs.
- The Results and Review tabs get a Section filter: a picker of CE's test categories
  (`valueset.expand` of `urn:openldr:valueset:test-category`), with "All sections". It sits beside
  the existing filters and works at phone width.
- On authorise, the DiagnosticReport's `category` is the test's catalog category read live from CE
  at that moment (`system` `urn:openldr:codesystem:test-category`, code and display), so the report
  says what the catalog says then. No category in the catalog: no `category`.

## Performing lab

- `lab_settings_get` and `lab_settings_set` gain `labFacilityId` (text, empty means unset). A value
  must be a facility CE knows (`facilities.get`); anything else is `invalid`. Lab-wide, so a caller
  with a facility limit is refused, as today.
- Each DiagnosticReport gets `performer: [{ identifier: { system: <facility register>, value:
  <facilityCode> }, display: <name> }]`, the same form as the ServiceRequest's requester. A
  facility must have a register code to be set. A facility CE no longer has, or one that lost its
  code, sends no performer (changed after review, 2026-11-25: a name alone becomes a facility in the
  warehouse that matches no register entry).
- The Settings tab shows "This lab's facility" with a facility search picker, saved at once with a
  toast, as the self-authorise switch is.
- CLI: `openldr plugin call lab lab_settings_set --input '{"labFacilityId":"..."}'`.

## Proof

- `cargo test`: category copied at register, the two filters, the report's category read live, the
  setting's checks, the performer on a report and its absence when unset.
- UI tests: the Section filters send `category`; the facility setting saves and shows.
- Live check on the dev stack: a report in CE carries category and performer; the warehouse
  `diagnostic_reports` row has the performer.
- The guide (en, fr, pt) names the Section filter and the setting.

## Left to the builder

- Where exactly each filter sits in each tab's toolbar, copied from the Orders facility filter.
- The fr and pt words.
