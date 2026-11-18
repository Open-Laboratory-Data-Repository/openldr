# Keep the anomaly flags on saved requests

Date: 2026-11-18. Short design. Approach chosen by the operator: A.

## Why

On the 2026-11-18 call the team asked whether the anomaly flags the cdr toolchain used to send are gone. For
saved requests they are. The plugin's audit (cdr-source `src/audit.rs`, 18 rules) finds them. An error
holds the request back. A warning or an info finding goes into the payload's `data_quality` block
(`src/payload_results.rs:455`). But the FHIR builder (`src/fhir.rs` `resources()`) never reads that block,
so the finding is dropped. The toolchain sent the block with every v2 payload that had a finding.

Held requests are not affected. CE keeps their findings in `import_check_held`.

## Goal

A saved request with at least one finding carries its findings into CE, where an analyst can filter on
them and read them in full.

Non-goals: a page or report that shows the flags; any change to which findings hold a request; flags for
held requests (they already have theirs).

## Approaches

- **A. Two request attributes (chosen).** One holds the class names to filter on, one holds the full
  findings. Two new codes. Nothing lost, easy to query.
- B. One code per rule. 18 new codes, one row each. A new rule later needs a CE change, and the message
  and details are lost unless stored too.
- C. Full findings only. One code. Smallest, but hard to filter in SQL.

## Design

The plugin adds two request attributes to each saved `ServiceRequest` whose audit found anything, in the
same way `add_mark` adds `v1-check` today (`src/decode.rs:164`). Same extension URL
`urn:openldr:ext:request-attribute`, same system `urn:openldr:cs:request-attribute`.

- `v1-flags`: the distinct finding classes, sorted, joined by commas. Example:
  `dates_out_of_order,dob_future_dated`.
- `v1-findings`: the findings as JSON text, exactly the `anomalies` array the toolchain sent: class,
  severity, message, the optional panel and observation fields when set, and details.

A request with no finding gets neither attribute, as the toolchain left out the block.

CE needs no code change to store them: `projectServiceRequestAttributes`
(`packages/db/src/relational/service-request.ts:40`) already writes any coded attribute to
`lab_request_attributes`, one row per code. CE adds the two codes with display names to
`packages/terminology/codesystems/openldr-request-attribute.json`, so pages show a name, not a bare code.

## Constraints

- AGENTS.md section 8: a fact from one system is a row in `lab_request_attributes`, never a new column.
- The plugin keeps a stored result as stored. Findings are added, nothing is changed.
- A finding's message can carry a value from the request. It lands in the warehouse, where that same value
  already sits.
- cdr-source ships as 0.1.2. It is signed on the laptop and republished to the marketplace only on the
  operator's yes.

## Left to the builder

The exact display names in en, fr and pt, the test fixtures, and the docs lines (the cdr-source guide and
the fault catalogue gain an entry for this fault).
