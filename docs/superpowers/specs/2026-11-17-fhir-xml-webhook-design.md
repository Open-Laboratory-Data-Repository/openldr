# FHIR XML at the webhook

## Why

A lab that sends FHIR as XML cannot reach CE today. Example 3 in the 2026-11-17 walkthrough
was a culture Bundle sent as XML. The webhook refused it with 415 for `application/fhir+xml` and
`application/xml`. Sent as `application/octet-stream`, it was stored as a file, so the Map to
FHIR node held it with "nothing at body". The same Bundle sent as JSON (example 2) stored all
six records.

## What it does

The webhook turns FHIR XML into FHIR JSON as it arrives. Every node after it, Map to FHIR
included, sees the same JSON a JSON sender gives. No node changes.

- It accepts `application/fhir+xml` and `application/xml`.
- It converts only FHIR XML: the root element must be in the `http://hl7.org/fhir` namespace.
  Any other XML is refused with 415, as it is today. The operator ruled this on 2026-11-17:
  only FHIR XML until there is a good reason for more.
- XML it cannot parse, or FHIR XML with a resource type the table below does not cover, is
  refused with a 400 or 415 that names the problem. Nothing is stored and no run starts.

## How

- The converter lives in `@openldr/fhir`, next to the table it reads, so any other entry point
  can reuse it.
- `packages/fhir/src/paths/r4-paths.generated.ts` already says, for each element of the nine
  resource types CE stores, whether it repeats and whether it is a number or true/false. The
  converter uses it to make lists and typed values. Bundle, Extension and narrative have a
  small fixed rule each, because they are not in the table.
- `fast-xml-parser` reads the XML. `packages/workflows` already uses it. It does not resolve
  external entities.

## Calls I made (the operator can change any of these)

- The narrative `text.div` is kept as its XHTML string, as FHIR JSON does.
- A primitive's own id or extension goes in `_name`, as the FHIR JSON rules say.
- A decimal like `1.50` becomes the JSON number `1.5`. FHIR JSON readers lose that too.
- Body size uses the webhook's existing limit.

## Not in this change

- XML that is not FHIR.
- Resource types outside the nine CE stores.
- A CLI command: the webhook is an ingest entry, not an admin feature.

## Done means

- Unit tests for the converter, including the walkthrough's XML Bundle giving the same JSON as
  example 2.
- Route tests for the 415 on non-FHIR XML and the 400 on broken XML.
- A run on the 3991 demo: example 3 stores six records, like example 2.
- In-app docs for the webhook node say it accepts FHIR XML, in en, fr and pt.
- Changelog after the merge.
