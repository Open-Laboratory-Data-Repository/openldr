# Report Visual Design Audit - Ministry of Health Readiness

Review date: 2026-08-07

Scope: the three supplied Reports-page outputs - Clinical Microbiology Report, AMR Cumulative Antibiogram, and AMR GLASS RIS (stratified) - plus the Report Designer/PDF-renderer capabilities that produced them.

Audience: Claude Code and future implementers.

No report implementation or source-code fix was made by this audit. This is a prioritized visual and document-quality punch list.

## Executive verdict

The reports are clean enough to demonstrate that the rendering pipeline works, but they are not yet ready to represent a Ministry of Health, national programme, reference laboratory, or accredited clinical laboratory. They currently look like well-spaced application exports: a product logo, a title, a few metadata labels, and a generic zebra-striped table. An official health document needs a stronger issuing identity, clearer document status and traceability, legible typography, explicit analytical meaning, complete empty/missing-data behavior, and a disciplined print design system.

The most important point is that this is not only a matter of moving elements around in Report Designer. The current PDF renderer hard-codes the visual language of tables and key/value panels, mixes px-at-96-DPI and point units, uses one fixed Helvetica treatment, and exposes only a very small style model. If Claude only edits the three seeded templates, the result will still be brittle and every new report will repeat the same defects.

The reports do have a useful foundation:

- margins are consistent and generally print-safe;
- the blue/slate palette is restrained;
- the two aggregate reports correctly use landscape orientation;
- the antibiogram was sensibly transposed so drug names remain readable;
- table column widths are content-proportional and plain numeric columns are right-aligned;
- table headers, light zebra striping, and bottom rules create a cleaner result than a full spreadsheet grid;
- the clinical report has started to establish patient/specimen hierarchy, a result section, and an authorization area;
- repeated headers and page-number support exist in the renderer, even though the supplied one-page outputs do not visibly demonstrate them.

Those strengths should be preserved. The next pass should make the documents authoritative, interpretable, and resilient rather than merely more decorative.

## Review basis and limits

The audit is based on the three screenshots supplied on 2026-08-07 and read-only inspection of the current repository. The screenshots contain sparse/demo data, so the audit distinguishes defects visible in the output from behavior that must be verified with populated, long, missing, and multi-page fixtures.

The review does not certify clinical, GLASS, CLSI, legal, branding, privacy, or accreditation compliance. Ministry brand rules and the issuing laboratory's document-control policy must be supplied by the responsible authority. The system must never invent a ministry name, crest, accreditation claim, authorizer, or verification URL.

## Priority definitions

- **P0 - blocks official use:** the document can look broken, incomplete, misleading, unauthorised, or analytically unsafe.
- **P1 - required for professional release:** the document is usable but visibly weak, difficult to scan, or inconsistent.
- **P2 - refinement:** polish that should follow the structural and semantic corrections.

## P0 findings - resolve before a Ministry pilot

### P0-01 - The issuing authority is absent; OpenLDR is presented as the issuer

All three pages lead with the OpenLDR app mark and the word `OpenLDR`. There is no ministry/programme name, laboratory/facility name, directorate, address, contact, or authorised institutional identity visible. This reads as a software-vendor document, not an official report issued by a health authority.

The product mark is also visually dominant relative to the actual report identity. In the landscape reports it is the strongest coloured object on the page, while the report title and scope have less visual authority.

Required direction:

- Create a configurable institutional masthead with a deliberate hierarchy: authorised emblem or facility logo; ministry/organisation; directorate/programme; laboratory/facility; address/contact; optional accreditation identifier.
- Treat OpenLDR as a quiet production-system credit in metadata or the footer, not as the issuing body.
- Provide explicit identity states. A configured issuer renders the official masthead. An unconfigured issuer must produce a clearly marked preview/draft or block official publication/export; it must not silently fall back to a vendor-looking final report.
- Support a text-only masthead when an authorised emblem is unavailable. Never show a broken-image placeholder on an official output.
- Do not seed a real ministry, crest, accreditation mark, or facility identity. Those must be authorised tenant configuration.

Relevant implementation: `packages/reporting/src/seed/simple-design.ts:94-102`, `packages/reporting/src/seed/report-seeds.ts:2164-2175`, and the lab identity work described in `docs/superpowers/specs/2026-08-06-report-facility-and-letterhead-design.md`.

### P0-02 - Dashed placeholder boxes are printed as if they were legitimate content

The clinical screenshot has a dashed empty barcode box in the top-right and a dashed empty QR box in the footer. These are renderer failure/empty placeholders exposed in the final document. To a clinician or auditor they look like missing data, a failed print, or a damaged document.

Required direction:

- Never render dashed designer placeholders in a published/final report.
- For optional symbols, omit the symbol and collapse/rebalance its space when no value exists.
- For required symbols, fail validation before generation and explain which bound value is missing.
- Test the generated barcode/QR with actual scanners after PDF generation and after normal office printing.
- Add a clear human-readable label for every code's purpose.

The current QR encodes the same lab number as the barcode (`packages/reporting/src/seed/report-seeds.ts:2239-2244`). That is redundant unless a documented workflow needs both. A QR that merely repeats a lab number must not visually imply online authenticity or verification. Either label its real purpose, change it to an authorised verification payload, or remove it.

Relevant renderer behavior: `packages/report-designer/src/render/draw.ts:583-587` and `:644-659`.

### P0-03 - The clinical report can look final while containing no patient, specimen, organism, or result values

In screenshot 1, the patient/specimen area contains only labels, the organism panel is empty, and the susceptibility table contains only its header. There is no prominent `No data`, `No organism isolated`, `No growth`, `Not tested`, or `Preview` state. A blank value is ambiguous: it could mean no result, unavailable data, a rendering failure, or an unselected request.

This is especially unsafe because the page still includes `Authorised by`, making an empty report look ready for sign-off.

Required direction:

- Do not generate an official clinical result until a valid request/result is selected and required bindings resolve.
- Add document status such as `PREVIEW`, `DRAFT`, `PRELIMINARY`, `FINAL`, `AMENDED`, or `CANCELLED`, driven by real workflow state.
- Define field-level missing states. Use clinically correct source-backed wording; never infer `No growth` merely because a query returned no row.
- If no isolate exists, render a single explicit result statement and omit or explain the susceptibility section according to the underlying clinical meaning.
- If the query fails, expose a clearly non-final error page in the application; do not create a report-shaped PDF that could be mistaken for a valid result.
- Suppress authorization content until the report is actually authorised.

### P0-04 - The clinical report lacks visible release traceability and key report information

The clinical output has only an underscore signature line. It does not visibly show a report status, issue/release date and time, timezone, authorizer name, role/credentials, report/version identifier, amended-report relationship, requester, patient identifier, collection date/time, or sample-quality/interpretive comments.

The exact required fields must be confirmed with the responsible laboratory and local policy, but the current page is visibly under-specified for an official result. WHO's Laboratory Quality Stepwise Implementation checklist calls for a fixed result-report format including laboratory identity, patient details, requester details, examinations, primary-sample collection date, sample type and quality comments, results/decision values where applicable, the authorising staff member, and release date/time.

Required direction:

- Add a compact document-control block: report ID/accession, status, issued/released timestamp with timezone, version/amendment indicator, and page count.
- Add the requesting clinician/facility or another source-backed requester identifier.
- Add a stable patient identifier in addition to patient name and DOB; avoid relying on name alone.
- Distinguish collection, receipt, analysis/finalisation, and release timestamps where available. Do not substitute one for another.
- Replace underscore-only signing with a structured authorization block: actual authorizer name, role/credentials, authorization timestamp, and optional validated digital-signature/verification reference.
- Add relevant method, interpretation standard/breakpoint version, specimen-quality note, and interpretive comments when supplied by the laboratory workflow.
- Include a clear confidentiality statement appropriate to local policy without overpowering the result.

Source references: [WHO LQSI information-management checklist](https://extranet.who.int/lqsi/checklist/14) and [WHO LQSI result review and authorization guidance](https://extranet.who.int/lqsi/content/start-reviewing-and-authorizing-results-ie-validation-results-releasing-report).

### P0-05 - The antibiogram does not identify what its percentages mean

Screenshot 2 displays cells such as `0% (1)` and `100% (1)`, but neither the title, table header, subtitle, nor legend says whether the percentage is resistant, susceptible, intermediate, or something else. The repository description says the cells are `%R with N tested` (`packages/reporting/src/seed/report-seeds.ts:2353-2356`), but that critical meaning is not on the document.

This is not a minor label omission. A reader could interpret `100%` as excellent susceptibility when the implementation means 100% resistant.

Required direction:

- Put the measure in the document title/subtitle and legend, for example `Percent resistant; n tested in parentheses`, subject to the laboratory's chosen standard and terminology.
- Label the statistic in every exported medium, not only in the Reports-page description.
- Explain first-isolate inclusion, specimen scope, population/facility scope, reporting period, breakpoint/interpretation standard and version, and any exclusion/suppression policy.
- Use a cell notation that remains understandable when copied, printed in greyscale, or read without the UI.

### P0-06 - Percentages based on one isolate are displayed with false visual authority

Every populated antibiogram cell in the screenshot has `n=1`, yet the percentage is presented at the same visual weight as a reliable estimate. Values of `0%` and `100%` derived from one observation are mathematically true but visually and clinically misleading without a prominent small-sample warning or suppression policy.

CLSI M39 is the relevant current standard for analysis and presentation of cumulative susceptibility data. CDC's current NHSN antibiogram guidance withholds percent susceptible when fewer than 30 isolates were tested and represents the withheld result with a symbol. OpenLDR must use a policy approved by the relevant laboratory/national programme; the audit is not dictating that the CDC threshold is universally applicable.

Required direction:

- Add a configurable, documented minimum-isolate rule approved by the programme.
- When below threshold, suppress the percentage or mark it `Insufficient data`; keep `n` available and explain the symbol in a legend.
- Never communicate statistical confidence through colour alone.
- Show isolate counts in organism headers or a dedicated line so the reader sees denominator strength before reading percentages.
- Add a prominent caveat if demo/test data intentionally bypass suppression.

Source references: [CLSI M39, fifth edition](https://clsi.org/shop/standards/m39/) and [CDC NHSN antimicrobial-resistance FAQ](https://www.cdc.gov/nhsn/faqs/faq-ar.html).

### P0-07 - Blank antibiogram cells have no defined meaning

The antibiogram has many empty cells and several entire drug rows without a value. A blank might mean not tested, not reported, suppressed, not applicable, below minimum isolate count, or missing data. Zebra stripes make the empty rows look intentional but do not explain them.

Required direction:

- Define distinct display tokens for at least `not tested`, `not applicable`, `insufficient n/suppressed`, and `missing/unknown`, if those states exist in the data.
- Include a legend directly beneath or above the table.
- If the fixed WHONET panel must be preserved, keep empty rows only when the panel itself is important and label their state. Otherwise omit rows with no data.
- Never use blank and zero interchangeably.

### P0-08 - The GLASS report looks submission-ready while required-looking scope fields are blank

Screenshot 3 shows `Country code —` and `Year —` while presenting an `AMR GLASS RIS` table. The source intentionally permits empty values and derives/falls back in the query (`packages/reporting/src/seed/report-seeds.ts:913-929`), but the visible document tells the reader the submission identity is incomplete. A regulatory-looking page with blank jurisdiction/year should not be presented as a normal final output.

The same page shows a reporting period of `2000-01-01 – 2027-12-31` and a generated date of `07/08/2026`; the scope therefore visibly extends into the future. The date format is also ambiguous between day/month and month/day. (The date range above is quoted product output, en dash included.)

Required direction:

- Require a valid ISO 3166-1 alpha-3 country code or the programme-approved jurisdiction identifier for final/submission output.
- Require and validate the reporting year/period appropriate to the GLASS workflow.
- Prevent a final report whose period end is after its generated/as-of time unless the report type explicitly supports forecasts; this one does not appear to.
- Mark incomplete runs as Draft/Incomplete and list validation failures prominently.
- Use unambiguous display dates such as `7 Aug 2026` and timestamps such as `7 Aug 2026, 14:35 EAT`; machine exports may retain ISO dates.
- Confirm the reporting period and year agree. A multi-year range must not be visually summarized as a single year without a clear rule.

### P0-09 - The GLASS table uses unexplained machine codes and acronyms

`CSF`, `PUSE`, `STOOL`, `HAEIN`, `NEIME`, `PSEAE`, `SHIFL`, `STRPN`, and `R/I/S` are presented without a legend. `AMR`, `GLASS`, and `RIS` are also unexplained. These may be correct machine/export codes, but they are not professional human-facing labels.

Required direction:

- Separate the human review document from the exact machine-submission artifact if their needs conflict.
- In the human review document, render source-backed display names with the code secondary, for example `Cerebrospinal fluid (CSF)`. Do not invent code expansions.
- Expand `Resistant`, `Intermediate`, and `Susceptible` or provide a persistent legend; group them under a higher-level header such as `AST result (isolate count)`.
- Spell out `Antimicrobial resistance (AMR)` and `Global Antimicrobial Resistance and Use Surveillance System (GLASS)` in a subtitle or notes block.
- Preserve exact machine codes in CSV/JSON/submission exports and optionally in parentheses on the PDF.

WHO identifies age, gender, infection origin, microbiological identification, and susceptibility results as important GLASS variables, so the report should make those dimensions understandable rather than merely present. Source: [WHO GLASS-AMR routine surveillance](https://www.who.int/initiatives/glass/glass-routine-data-surveillance).

### P0-10 - Very small, low-contrast text makes the reports fail normal print use

Several text elements are authored at `7`, `7.5`, or `8` px-at-96-DPI and then multiplied by `0.75` in the renderer. That produces approximately 5.25 pt, 5.625 pt, and 6 pt text for the footer, address/contact, section label, and signature (`packages/report-designer/src/render/draw.ts:681-687`). Meanwhile table and key/value sizes are hard-coded directly in points at 6.5-8.5 pt. The result is both too small and internally inconsistent.

The palest footer text uses `#94a3b8` at about 5.25 pt. It is barely visible in the screenshots and is likely to disappear on ordinary monochrome printers, photocopies, scans, low-ink devices, and PDF thumbnails.

Required direction:

- Establish one unit system for typography, preferably points in the PDF model, and migrate existing templates deliberately.
- Use a tested minimum print size. As a starting target, body/table text should normally be 9-10 pt, metadata 8.5-9 pt, and footnotes no smaller than 7.5-8 pt; validate with the Ministry/laboratory and actual printers.
- Increase contrast for all essential information. Muted text must remain legible in greyscale and on low-quality office printers.
- Add a lint rule that blocks or warns on text below the approved minimum and on insufficient contrast.
- Remove the Report Designer's unsafe `min={4}` font-size floor (`apps/studio/src/report-designer/PropertiesTab.tsx:138` and `:317`).

## P1 findings - required professional document system

### P1-01 - There is no coherent typography system

The visual hierarchy is made from size changes and bold Helvetica only. There is no configurable font family, medium/semibold weight, italic, line height, letter spacing, case policy, or rich run styling. Table, key/value, barcode captions, page numbers, and text elements use unrelated hard-coded sizes.

Consequences visible in the screenshots:

- report titles feel like UI headings rather than document titles;
- field labels are too small and too close in weight to values;
- scientific organism names cannot be italicised;
- long labels and headers have no graceful wrap strategy;
- all-caps section bands become dense because letter spacing cannot be controlled;
- the clinical title, section bands, table text, footer, and authorization line do not feel like one system.

Required direction:

- Add a document-level type scale with named roles: institution, report title, subtitle, section heading, body, table header/body, metadata label/value, note, footer.
- Embed an approved, widely available family such as Noto Sans or Source Sans 3, or use an approved system font with a verified embedding/licensing path. Provide a dependable fallback.
- Support at least regular, semibold/bold, and italic styles. Use italics for scientific binomials where the display data can be reliably identified.
- Use sentence/title case for most headings. Reserve uppercase for short codes or a small number of section labels.

### P1-02 - The masthead and report-title hierarchy is weak

In screenshots 2 and 3, the logo block dominates while `OpenLDR`, the report title, and metadata feel disconnected. In screenshot 1, the main report title is quite small and the subtitle is almost footnote-sized. A thin rule is doing most of the grouping work.

Required direction:

- Treat the masthead as one aligned component, not a logo and several independent absolute-positioned text boxes.
- Align emblem, institution lines, report family, and document-control metadata to a shared grid.
- Give the report title a clear second band or stable location below the institutional identity.
- Add a short descriptive subtitle where the title contains technical shorthand.
- Keep the masthead compact enough that data begins early, but do not compress it into unreadable text.

### P1-03 - Scope metadata is too sparse and visually under-designed

The aggregate reports show only a period, generated date, and in GLASS two additional labels. The pairs float in two wide columns with weak grouping and no higher-level label such as `Report scope`. The antibiogram has no facility/geographic scope even though the report is described as cross-facility in code.

Required direction:

- Create a compact scope panel with consistent label/value alignment and a subtle background or rule, not a large loose field.
- Show the actual analysis scope: facility/geography, specimen scope, patient setting, reporting period, generated/as-of timestamp, first-isolate rule, and data source/version as appropriate.
- Render an unset optional filter as `All facilities`, `All specimen types`, or another accurate phrase instead of `—` when the semantics are truly "all." Use `Not recorded`/`Not supplied` only for missing data, not for an intentional all-scope.
- Make optional fields collapse cleanly so two populated pairs do not occupy the space of six.
- For national reports, distinguish `issuing institution` from `data scope`; they are not necessarily the same facility.

### P1-04 - Dates and times are not presentation-ready

`07/08/2026` is ambiguous. ISO date ranges are technically clear but visually mechanical. Generated date has no time or timezone, which weakens traceability and makes repeated runs on the same day indistinguishable.

Required direction:

- Use a locale-aware but unambiguous human display format, with month names.
- Include time and timezone for generated/issued/authorised events.
- Keep machine-stable ISO values in exports and metadata where useful.
- Support locale/translation without hard-coding English date syntax in the renderer.
- Use an en dash for ranges with consistent nonbreaking behavior.

### P1-05 - Page footers are too faint, generic, and incomplete

`Generated by OpenLDR — figures reflect data available at time of generation.` is tiny, generic, and hard to see. (That em dash is the product's own string, quoted as evidence.) It does not identify the report, run, scope, classification, or page. The clinical disclaimer is similarly faint. `Page X / Y` support exists but is not visibly evident in the supplied screenshots and uses another fixed style.

Required direction:

- Build a reusable footer with report/document ID, generated or issued timestamp, page `X of Y`, confidentiality/classification where applicable, and a quiet system credit.
- Repeat it on every physical page.
- Keep it legible but subordinate; do not use ultra-light grey.
- Use `Page X of Y`, localized, rather than a slash if that matches the document language.
- Separate clinical interpretation notes from document-control metadata. A clinical disclaimer belongs near the relevant result or in a notes section, not hidden in vendor-credit microtext.

### P1-06 - Empty space is not being used deliberately

The clinical result block ends near the upper third of the page and the footer is fixed at the bottom, leaving more than half the sheet visually empty. Screenshot 3 also has a large unstructured gap between the table and footer. White space is desirable, but this reads as missing content because the result areas themselves are empty or very small.

Required direction:

- Keep the footer at the physical bottom, but let the body use content-aware flow.
- For short clinical results, use a more balanced authorization/notes block and a clear end-of-report marker so the blank area does not look like a failed render.
- For GLASS, use the available area for a legend, methodology, data-quality summary, validation warnings, or sign-off metadata rather than decorative filler.
- Do not vertically stretch rows simply to fill a page; density should remain consistent across short and long runs.
- Avoid fixed-height result boxes that leave invisible empty rectangles when there are no rows.

### P1-07 - Table typography and row rhythm are too tight

Tables are hard-coded to 8 pt with a 16 pt row, 4 pt text inset, one-line ellipsis, and no adjustable leading (`packages/report-designer/src/render/draw.ts:53-60` and `:711-779`). This is efficient but cramped for official print, especially with long antimicrobial names and ten-column GLASS rows.

Required direction:

- Make table density a style token or table-level setting rather than a renderer constant.
- Support at least comfortable and compact modes, with approved minimum sizes.
- Allow wrapped headers and controlled two-line cells with row-height calculation, or support explicit abbreviations plus a legend.
- Keep repeated headers on continuation pages.
- Add optional explicit column widths/minimums and alignment overrides.
- Prevent ellipsis from being the only overflow behavior on a final PDF. The complete human-facing value must be available on the report or in a clearly linked legend/appendix.

### P1-08 - The table hierarchy is only one row deep

The GLASS columns `R`, `I`, `S`, and `Total` should read as one result group, but the renderer cannot create grouped/spanning headers. The antibiogram pathogen headings need a shared measure label and often an isolate count. One flat header row forces the reader to reconstruct the structure.

Required direction:

- Add multi-row/grouped headers with column spans.
- Repeat the complete header hierarchy on every page.
- Allow a table caption/subtitle and legend tied to the table.
- Provide section/group rows for therapeutic classes, specimen/pathogen groups, or other data-defined groupings.
- Ensure grouped headers remain understandable in text extraction and accessible reading order.

### P1-09 - The antibiogram needs a stronger information architecture

The transpose fixes width but the result is still an alphabetical list of drugs crossed with organism names. It lacks clinical grouping, totals, methodology, and a visual anchor for the metric.

Required direction:

- Group antimicrobials by the programme-approved therapeutic/class order rather than relying only on alphabetic order, if the underlying standard supplies that grouping.
- Show organism isolate count prominently in the column heading or directly below it.
- Use readable scientific display names and italicise binomials; preserve source codes in metadata/export.
- Place `Metric: % resistant` and `n = isolates tested` immediately above the table.
- Add a legend for blank/suppressed/not-tested cells and any breakpoint annotations.
- Consider very restrained threshold highlighting only after the statistical/suppression policy is correct. It must work in greyscale and never be the sole carrier of meaning.
- Verify whether the intended audience expects `%R` or the more conventional `%S`; do not change the metric merely for appearance.

### P1-10 - The GLASS table reads like a database extract

Repeated `unknown` values, repeated specimen/pathogen codes, short machine headers, and many `0/1` columns make screenshot 3 look like a query result. Zebra striping alone cannot establish a public-health reporting hierarchy.

Required direction:

- Add a validation/data-quality summary above the table: total isolates/strata, percentage with age recorded, gender recorded, and origin recorded, plus incomplete required fields.
- Render missing epidemiological values as an intentionally styled category (`Not recorded`) or the exact required GLASS code, explained once in a legend.
- Group or visually separate specimen/pathogen blocks with subtle rules or group headings.
- Use a descriptive title such as `GLASS AMR aggregated RIS review` if that better matches the artifact; confirm official naming with the programme.
- Keep the exact flat submission shape available separately. A review PDF and a machine submission file do not need identical presentation.
- Add a clear submission-validation outcome (`Ready`, `Warnings`, `Not ready`) driven by actual validation, not visual decoration.

### P1-11 - Data quality problems are visually normalized

In screenshot 3, nearly every Age and Origin value is `unknown`, and many Gender values are also unknown. Because these are rendered like ordinary values, the page hides a major surveillance-quality problem in plain sight.

Required direction:

- Add completeness metrics and thresholds approved by the programme.
- Visually distinguish `not recorded` from valid categories without using alarm colour on every row.
- Add a concise data-quality callout when completeness falls below an approved threshold.
- Keep the raw unknown rows; do not "clean" or fabricate them in presentation code.
- Provide a drill-down/export path for remediation, but do not overload the PDF with operational instructions.

### P1-12 - Clinical section bands are heavy while the content beneath them is too weak

The dark slate `ORGANISM ISOLATED` and `ANTIMICROBIAL SUSCEPTIBILITY` bands create strong horizontal bars, but their body content is absent/tiny. The section treatment therefore draws more attention to the chrome than to the clinical result.

Required direction:

- Reduce band weight or use a lighter section-heading treatment once typography is strong enough.
- Make the organism/result value the focal point, with the label subordinate.
- Use status colour only when it maps to a source-backed state and always retain an explicit text label.
- Keep section treatments consistent across clinical disciplines; do not create a unique bar language for every template.

### P1-13 - The clinical patient/specimen panel is difficult to scan

The two-column label list has adequate broad alignment, but values are not visually distinct in the empty screenshot and the reading order alternates left/right across five rows. Small labels and generous horizontal gaps make it easy to lose the label-value association.

Required direction:

- Use stronger value typography and a quieter label style.
- Group fields semantically: Patient, Request, Specimen, Laboratory. Do not mix them only to fill a two-column grid.
- Put the accession/lab number and patient ID where they are quickest to verify.
- Keep date/time values and their labels together.
- Define overflow behavior for long names, facility names, and locations. Test real maximum-length values.
- Add colons only if the design system uses them consistently; spacing and weight may be enough.

### P1-14 - Authorization is visually and semantically weak

`Authorised by ______________________` resembles a blank paper form rather than an electronically generated official report. It gives no clue whether the line is for wet signature, a rendered digital signature, or a missing binding.

Required direction:

- Choose and label the authorization model: wet signature area, authenticated electronic release, or digitally verifiable signature.
- For electronic release, print name, credentials/role, date/time, and an audit/reference identifier.
- For wet signature, provide a correctly sized line plus printed-name and date labels, but only where local policy requires it.
- Never print an empty authorization field on a report marked Final.

### P1-15 - Colours are restrained but not yet a validated print/accessibility palette

The current palette uses dark slate section bands, pale blue-grey headers, very light zebra rows, green/red/grey status colours, and light footer text. It looks calm on screen, but there is no evidence in the output of greyscale, colour-vision, low-ink, photocopy, or contrast testing.

Required direction:

- Define tenant-configurable brand colours plus a fixed neutral/semantic palette.
- Validate essential text contrast at the actual printed size.
- Pair every semantic colour with text/symbol/label.
- Ensure resistant/intermediate/susceptible states remain distinguishable in greyscale.
- Avoid pale fills that disappear and dark fills that turn to large toner-heavy blocks.
- Test on black-and-white laser and common inkjet output, not only PDF screenshots.

### P1-16 - Scientific and clinical nomenclature lacks deliberate formatting

Organism names appear as ordinary bold headers. Antimicrobial capitalization and slash-separated names are mechanically inherited from data. Machine codes and display names are inconsistently used between the antibiogram and GLASS report.

Required direction:

- Establish a source-backed display-name layer separate from stable codes.
- Support italic text runs for genus/species names without italicising qualifiers such as `spp.` incorrectly; confirm exact local convention.
- Use approved antimicrobial display names and class ordering.
- Preserve source code and original value for traceability, but do not make raw codes the primary human-facing label.
- Add terminology-version metadata where the report's interpretation depends on a standard/version.

### P1-17 - Long-content and pagination behavior needs visual proof

The screenshots are one-page samples. The renderer paginates fixed-height tables in constant 16 pt rows and repeats all page elements. That can work, but the professional result must be demonstrated for long titles, many organisms, long antibiotics, multiple pages, and a final short page.

Required direction:

- Create golden fixtures for minimum, normal, maximum, missing, and pathological content.
- Verify the masthead/footer repeat on every page without colliding with the table.
- Repeat table and grouped headers.
- Prevent rows from splitting, clipping, or hiding under the footer.
- Keep column widths identical across pages.
- Show `Page X of Y` on every page and a stable report/run ID.
- Verify that a one-row continuation page does not look broken.

### P1-18 - The PDFs need a defined accessibility and archival posture

The screenshots do not show whether text is selectable, reading order is meaningful, document title/language metadata exists, images have alternatives, or a tagged PDF/PDF-A profile is required. Even when full tagged-PDF support is out of scope, the visual system should not make accessibility worse.

Required direction:

- Confirm the Ministry's PDF accessibility and archival requirements.
- Keep essential content as text/vector, not raster screenshots.
- Set document title, author/issuer, subject, language, creation date, and report identifier metadata.
- Preserve logical reading order as far as the PDF library allows.
- Do not communicate meaning by position or colour alone.
- If tagged PDF or PDF/A is required and PDFKit cannot provide it, record the capability gap explicitly rather than claiming compliance.

## P2 findings - visual refinement after P0/P1

### P2-01 - Align every page to a documented grid

- Use one left edge for masthead, title, scope, table, notes, and footer.
- Align the right edge of the barcode/document-control block with the table.
- Use a 4 pt or 8 pt spacing rhythm rather than independent coordinates.
- Keep vertical gaps consistent between title, scope, table caption, table, notes, and footer.
- Optical-align logo/emblem with institution text; do not merely center their bounding boxes.

### P2-02 - Refine rules, fills, and borders

- Use a small set of rule weights with named roles: masthead divider, table header rule, group divider, footer divider.
- Avoid redundant borders around key/value panels if alignment and whitespace already provide grouping.
- Keep zebra striping subtle but visible in print; consider group rules as a better aid for GLASS.
- Avoid rounded app-card styling, drop shadows, gradients, decorative icons, and dashboard visuals in the PDF.

### P2-03 - Make section and report naming human-readable

- Replace internal suffixes such as `(stratified)` with a proper subtitle or scope statement.
- Use consistent title case and punctuation.
- Expand acronyms on first use.
- Avoid all-caps headings longer than a few words.

### P2-04 - Improve microcopy

- Replace generic `figures reflect data available at time of generation` with report-specific provenance and limitations.
- State whether date periods are inclusive.
- State the meaning of `n`, blank/suppressed symbols, first-isolate logic, and unknown categories.
- Use `Authorised` or `Authorized` consistently with the deployment locale.
- Prefer `Issued`/`Released` for the official event and `Generated` for the software event; they are not synonymous.

### P2-05 - Make the end of the report visually explicit

For sparse clinical reports, a quiet `End of report` marker above the authorization/footer area can reassure the reader that no rows were lost. Use only if it fits local convention and does not look like boilerplate clutter.

## Screenshot-specific punch lists

This section deliberately repeats some global findings so Claude can review each output independently.

### Screenshot 1 - Clinical Microbiology Report

1. Replace the OpenLDR-only masthead with configured issuer identity.
2. Remove dashed barcode/QR placeholders from final output.
3. Strengthen the report title and make the discipline subtitle readable.
4. Add report status, accession/report ID, issued timestamp, and version/amendment state.
5. Add a stable patient identifier and requester details.
6. Add collection date/time; do not treat `Received` as a substitute.
7. Make label/value pairs visibly distinct and grouped by Patient, Request, Specimen, and Laboratory.
8. Define missing-value behavior; never leave an official field silently blank.
9. Make the organism result the strongest item in the body.
10. If there is no organism, show the source-backed clinical outcome and conditionally handle AST.
11. If AST exists, explain R/I/S and the interpretation/breakpoint standard/version.
12. Add method, specimen quality, comments, and urgent/critical communication status if supplied by workflow and required by policy.
13. Increase table and metadata font sizes.
14. Reduce the visual weight of dark bars relative to clinical content.
15. Rebalance the large empty middle of the page without stretching rows.
16. Replace the underscore signature with a structured authorization block.
17. Explain the QR/barcode purpose; remove redundant code if it has no distinct workflow.
18. Add confidentiality, report ID, issue timestamp, and page count in a legible footer.
19. Test long names, long facility/location, multiple isolates, long AST panels, no-growth, amended, and multi-page results.
20. Prevent a blank/preview result from being downloadable as an apparently final report.

### Screenshot 2 - AMR Cumulative Antibiogram

1. State explicitly that cells are `% resistant` (if that remains the chosen metric) and that parentheses contain `n tested`.
2. Apply an approved small-sample/suppression rule; do not show authoritative 0%/100% with `n=1` without warning.
3. Define every blank-cell state in a legend.
4. Hide completely empty antimicrobial rows or mark them intentionally if the fixed panel must be shown.
5. Show isolate counts in organism headers.
6. Add facility/geographic/population/specimen scope or explicitly say that the report covers all available data.
7. Add methodology: first-isolate rule, period inclusivity, breakpoint/interpretation standard and version, exclusions, and data source/version.
8. Use a valid period that does not extend beyond the report's as-of/generated time.
9. Replace the ambiguous generated date with date/time/timezone.
10. Group drugs by an approved therapeutic/class order where available.
11. Italicise scientific binomials and support wrapped/stacked organism headers.
12. Verify headers do not ellipsize as more organisms clear the isolate threshold.
13. Consider restrained, accessible emphasis only after n/suppression semantics are correct.
14. Add a concise limitations note and a visible report/run ID.
15. Make the footer and page number legible.
16. Ensure the table still works in greyscale, photocopy, and multi-page output.

### Screenshot 3 - AMR GLASS RIS (stratified)

1. Do not present blank Country code/Year as a normal final report.
2. Validate the future-ended period and agreement between period and reporting year.
3. Expand AMR/GLASS/RIS on first use.
4. Provide human-readable specimen/pathogen labels with codes secondary, or a complete legend.
5. Expand or group R/I/S under a susceptibility-result header.
6. Add a submission/readiness validation status.
7. Add total isolates/strata and completeness metrics for age, gender, and origin.
8. Visually distinguish `Not recorded` without painting every row as an error.
9. Group specimen/pathogen blocks or add subtle group separators.
10. Support long antimicrobial names without clipping/ellipsis.
11. Explain whether the document is a human review report or the exact submission shape.
12. Add source/version/methodology and country/programme identity.
13. Use the lower-page space for legend, validation, methodology, and sign-off rather than leaving an unexplained gap.
14. Add legible document-control footer and page count.
15. Test annual/multi-year, multiple age groups, many facilities/sources, multi-page, and invalid/incomplete cases.

## Required reusable design system

Claude should implement a report design system before or alongside reworking the seeds. Exact values require print testing and Ministry approval, but the system should expose named tokens rather than scattered coordinates.

### Page and grid

- Paper: explicit A4 and Letter support, portrait and landscape.
- Margins: approved physical measurements, not magic pixels; allow a safe minimum for office printers.
- Grid: one document spacing scale and shared content edges.
- Regions: masthead, report identity/control, scope, body, notes/legend, authorization, footer.
- Repeating regions: master-page header/footer with reserved body bounds.
- Flow: content-aware vertical layout and optional conditional collapse; absolute positioning may remain available for specialised forms.

### Typography tokens

- Institution/programme name.
- Report title and subtitle.
- Section heading.
- Body/value.
- Metadata label/value.
- Table caption, header, body, and group header.
- Note/legend.
- Footer/document control.
- Scientific-name italic run.

All tokens need actual PDF units, font family, weight, size, line height, colour, and overflow behavior. They should be shared by designer preview and PDF output.

### Colour tokens

- Configured primary brand and optional secondary accent.
- Text strong/default/muted.
- Rule strong/default/subtle.
- Table header and alternate row.
- Semantic normal/warning/critical/indeterminate/none.
- Draft/incomplete watermark.

Every semantic token must have a non-colour representation and a greyscale-safe result.

### Table tokens and capabilities

- Comfortable/compact density.
- Header height, row padding, font sizes, line height.
- Wrapped/multi-line headers and cells.
- Explicit/min/max/auto column widths.
- Column and cell alignment/formatting.
- Multi-row grouped headers and column spans.
- Row groups, group labels, and separators.
- Null/missing/not-applicable/suppressed formatting.
- Percentage/count/date/time/scientific-name formatters.
- Cell footnote markers and legend support.
- Repeated headers and consistent widths across pages.
- Table caption and continuation label.

### Document-control capabilities

- Draft/final/amended/cancelled status.
- Report/document ID, run ID, version, prior-version reference.
- Generated, authorised, and issued timestamps plus timezone.
- Authorizer identity/role and authorization method.
- Page X of Y.
- Issuer identity and confidentiality class.
- Optional verification reference whose purpose is explicit and whose payload is validated.

## Report Designer and renderer capability gaps

These gaps explain why the screenshots cannot be fixed robustly by template coordinates alone.

### 1. Element styles are too small a vocabulary

`ElementStyleSchema` only supports `fontSize`, `bold`, `align`, `color`, `strokeColor`, `strokeWidth`, and `fill` (`packages/report-designer/src/schema.ts:11-19`). It lacks font family, weight, italic, line height, letter spacing, opacity, padding, radius, text transform, vertical alignment, overflow policy, and semantic style role.

Recommendation: introduce document theme/style roles first, then optional per-element overrides. Avoid turning every visual token into an unrelated manual field.

### 2. Table styling is hard-coded and ignores element style

The renderer fixes palette, 8 pt type, 16 pt rows, cell padding, zebra behavior, rule weights, and single-line ellipsis in `packages/report-designer/src/render/draw.ts:10-21`, `:53-94`, and `:711-779`. Report Designer cannot materially restyle a table.

Recommendation: define a serialised table-style contract and expose a focused set of approved variants/settings. Keep safe defaults and lint against unreadable combinations.

### 3. Key/value styling is hard-coded

Key/value title, label, value sizes, spacing, label fraction, gutters, and colours are constants at `packages/report-designer/src/render/draw.ts:299-320`. The element's style affects only a small part of the panel.

Recommendation: move these to theme roles plus panel density/layout settings. Add semantic groups and conditional field visibility.

### 4. Typography units are inconsistent

Text-element font sizes are px-at-96-DPI converted to points (`:681-687`); table/key/value/barcode/page-number sizes are direct point constants. Layout comments already document previous px/pt bugs. This makes authoring, preview parity, and minimum-size validation error-prone.

Recommendation: choose one canonical persisted unit or add explicit unit/version semantics and migrate old designs. Add parity tests that measure the actual PDF font sizes and boxes.

### 5. The designer permits 4-unit text

The font control uses `min={4}`. That makes illegible official output a valid authored design.

Recommendation: apply role-aware minimums, warn during authoring, and block publication when required text violates print rules. Allow an audited expert override only if there is a genuine barcode/technical use case.

### 6. There is no master-page or reusable document component model

The same logo/name/rules/footer are manually duplicated in seed designs. Coordinate duplication guarantees drift and makes tenant-wide updates difficult.

Recommendation: add reusable/locked masthead, scope, footer, legend, and authorization components or master-page regions. Updating institutional identity should update all reports without re-authoring every page.

### 7. There is no conditional visibility or reflow

Missing logos/codes become placeholders and empty result sections leave large gaps. Absolute rectangles do not collapse.

Recommendation: support safe conditions such as `hide when empty`, `show when rows exist`, `required for final`, and flow/reflow within defined regions. Conditions must be declarative and testable, not arbitrary code.

### 8. There is no grouped-header or row-group model

The flat table schema cannot express the GLASS R/I/S group or antimicrobial classes.

Recommendation: extend the table schema with header groups/column spans and data-driven row grouping while preserving the simple flat-table path.

### 9. Overflow policy is too rigid

Every table cell is one line with ellipsis. That prevents overlap but hides clinically relevant text in a final PDF.

Recommendation: support controlled wrapping/auto height, explicit abbreviations with legends, and publication lint for clipped final content. Keep deterministic pagination.

### 10. Publication lint is not document-quality lint

The system needs preflight rules beyond schema validity.

At minimum lint for:

- missing/unconfigured issuer identity;
- unresolved/broken images, barcode, or QR values;
- required fields empty for Final status;
- font below approved minimum;
- low text contrast;
- element overlap or out-of-page bounds;
- clipped/ellipsized final text;
- table/body collision with repeating footer;
- future or contradictory report period;
- ambiguous date format;
- missing table metric/legend for formatted cells;
- missing page number/report ID on multi-page output;
- unexpanded acronyms/codes in a human-facing template where a legend is required;
- missing GLASS submission identifiers/validation state;
- sample-size/suppression policy absent for cumulative antibiograms.

### 11. Preview fixtures are not adversarial enough

A sparse preview can look tidy while a real report clips. The previous source comments show that unit mismatches and long antimicrobial names have already produced visual defects.

Recommendation: make preview data selectable: realistic, empty, longest values, all optional fields, smallest page, large table, multi-page, missing identity, broken image, and low-n/suppressed states. Provide print-preview zoom at actual size.

### 12. PDF metadata and compliance capabilities are not visible in the design model

Recommendation: add document metadata and explicitly decide whether tagged PDF, PDF/A, digital signatures, and archival requirements are supported. Do not bury these in template text.

## Recommended visual direction

Use a restrained public-health document style, not a dashboard printed onto paper:

- institution-led masthead with one authorised accent colour;
- strong but compact report title and status;
- structured scope/document-control panel;
- high-contrast, comfortably sized type;
- neutral tables with clear group hierarchy and limited rules;
- sparse, source-backed semantic colour;
- concise legends and methodology notes;
- structured authorization and traceable footer;
- no gradients, shadows, glossy cards, oversized app icons, decorative charts, or excessive dark bars.

The best outcome should still look credible when printed in black and white, photocopied, or viewed at 100% on an ordinary laptop.

## Suggested implementation order

1. Define official/draft publication states and required issuer/document-control data.
2. Normalize typography units and introduce theme roles with print-safe minimums.
3. Add master masthead/footer/scope/authorization components.
4. Add conditional visibility, required-binding validation, and publication preflight.
5. Add table styling, wrapping, grouped headers, row grouping, and null/suppression states.
6. Correct antibiogram measure labels, denominator/suppression policy, legend, and methodology.
7. Correct GLASS validation, human labels/legends, completeness summary, and review-vs-submission split.
8. Re-author the three seeded templates using the shared system.
9. Render and visually review all golden fixtures on A4/Letter, portrait/landscape, one-page/multi-page, colour/greyscale, and normal office printers.
10. Obtain laboratory/Ministry review before calling the templates production-ready.

## Acceptance criteria

### Global

- No final PDF contains a dashed placeholder, unresolved token, broken image, blank required binding, or empty authorization line.
- Issuing institution and report status are unambiguous.
- Essential text remains legible at actual print size and in greyscale.
- All dates are unambiguous; official events include time and timezone.
- Footer contains report/document ID and page X of Y on every page.
- A long-value fixture produces no overlap, clipping, or unexplained ellipsis.
- A multi-page fixture repeats masthead/footer and the full table header without collisions.
- Missing, not applicable, not tested, suppressed, and zero are visually distinct wherever those states occur.
- PDF metadata is populated and the supported accessibility/archival profile is documented.
- Designer preview and generated PDF use the same style tokens and produce measured parity.

### Clinical Microbiology Report

- A Final report cannot be generated without required patient/request/specimen/result/authorization fields defined by policy.
- Patient ID, accession, requester, specimen type, collection/receipt/release times, status, and authorizer are readable and traceable where available/required.
- No-isolate/no-growth/no-result states are source-backed and explicit.
- AST meaning and interpretation standard/version are documented.
- Barcode/QR has a valid value, explicit purpose, and scanner-tested output, or is omitted without leaving a gap.
- Short and long result sets both produce a balanced page.

### AMR Cumulative Antibiogram

- The displayed percentage metric and denominator notation are explicit.
- An approved minimum-isolate/suppression rule is applied and explained.
- Every blank/symbol state has a legend.
- Scope, first-isolate rule, interpretation standard/version, and period are visible.
- Organism isolate counts are visible before the reader interprets percentages.
- Empty panel rows are omitted or intentionally marked.

### AMR GLASS RIS

- Country/jurisdiction and reporting year/period validate before Final/Ready status.
- Period does not extend beyond the as-of time and agrees with the report year policy.
- Codes/acronyms are expanded or completely explained.
- R/I/S columns are grouped and explained.
- Data completeness for age, gender, and origin is summarized.
- The PDF clearly states whether it is a human review document or the submission artifact.

## Verification matrix Claude should add

| Dimension | Required cases |
|---|---|
| Identity | fully configured; text-only; missing; very long ministry/lab names |
| Status | Preview; Draft; Preliminary; Final; Amended; Cancelled |
| Data | normal; empty; null-heavy; long values; special characters; maximum rows |
| Clinical | no growth/no isolate; one isolate; multiple isolates; long AST; amended result |
| Antibiogram | n below threshold; n at threshold; n above threshold; empty cell; not tested; many organisms |
| GLASS | valid annual run; missing country; missing year; future period; unknown-heavy; multi-year data |
| Page | A4/Letter; portrait/landscape; one page; two pages; many pages |
| Output | colour; greyscale; photocopy; low-ink printer; 100% PDF view; thumbnail |
| Accessibility | selectable text; metadata; reading order; colour-independent meaning |
| Codes | barcode/QR populated, empty, too long, unencodable, and physically scanned |

Visual verification should include rendered-page image diffs plus human review. Geometry/unit tests alone are not sufficient.

## Do not do these things

- Do not fix the screenshots with three more sets of hand-tuned absolute coordinates only.
- Do not add a real ministry crest/name as a demo default.
- Do not hide incomplete official fields by rendering them blank.
- Do not make reports look "premium" with shadows, gradients, glossy cards, or decorative icons.
- Do not shrink fonts to make wide data fit.
- Do not rely on colour alone for clinical or statistical meaning.
- Do not display a QR as a verification mark unless it actually verifies a report through an authorised, secure workflow.
- Do not turn unknown source data into plausible-looking values.
- Do not show percentages below an approved denominator threshold without the approved warning/suppression behavior.
- Do not claim ISO, GLASS, CLSI, accessibility, PDF/A, digital-signature, Ministry-brand, or accreditation compliance without formal validation.

## External reference points

- [WHO LQSI information-management checklist](https://extranet.who.int/lqsi/checklist/14) - fields and authorization/release information expected in a fixed laboratory result-report format.
- [WHO LQSI result review and authorization guidance](https://extranet.who.int/lqsi/content/start-reviewing-and-authorizing-results-ie-validation-results-releasing-report) - legibility, completeness, review, and authorization before release.
- [WHO LQSI recording, reporting, and archiving guidance](https://extranet.who.int/lqsi/content/write-sop-recording-reporting-and-archiving-results) - standardised, quality-controlled official reports and visible handling of alterations.
- [WHO GLASS-AMR routine surveillance](https://www.who.int/initiatives/glass/glass-routine-data-surveillance) - microbiological, demographic, and epidemiological variables used in GLASS surveillance.
- [CLSI M39, fifth edition](https://clsi.org/shop/standards/m39/) - current standard for analysis and presentation of cumulative antimicrobial susceptibility test data.
- [CDC NHSN antimicrobial-resistance FAQ](https://www.cdc.gov/nhsn/faqs/faq-ar.html) - a current operational example of explicitly reporting `%S`, `n tested`, and suppressing percentages below 30 isolates.

## Final assessment

The current designs are a credible engineering milestone, not a finished institutional reporting system. Their strongest qualities - restraint, consistent margins, transposed antibiogram, and improved table geometry - should remain. The next iteration must shift the centre of gravity from `OpenLDR generated this table` to `this authorised institution issued a clear, traceable, clinically/public-health interpretable document`.

## Addendum - Report Designer WYSIWYG and authoring experience

Addendum date: 2026-08-07

Scope: the Report Designer page itself, not only the three report outputs. This review covers the current canvas, template explorer, layers, properties/data inspector, live preview, PDF renderer contract, publishing behavior, and the capabilities needed to design the wider report catalogue consistently.

### Addendum executive assessment

The Report Designer is a strong foundation. It already has a real printable-page metaphor, multi-selection, marquee selection, eight resize handles, group scaling, arrow-key nudging, undo/redo, autosave, alignment guides, margins, query binding, parameter editing, real barcode/QR geometry, PDF preview, export, and publishing. This is substantially more capable than a form that merely asks for report settings.

The weakness is exactly what the user suspected: it is not yet sufficiently WYSIWYG. The editor and the PDF are two different renderers with different data and layout knowledge. The canvas is a fast place to arrange things. Preview is where the author finally discovers real table headers, values, column widths, numeric alignment, zebra rows, status styling, pagination, page numbers, token substitution, query errors, and some image failures. The author is therefore designing a box that will later contain a report, rather than directly designing the report they will publish.

The recommended product direction is a **hybrid professional report designer**:

- retain the free-form page canvas for precise placement;
- add layout containers and reusable health-report components for consistency;
- add a persistent Live Print mode driven by the same resolved layout as the PDF;
- add first-class pages, layers, themes, preflight, draft/revision, and publication governance;
- keep raw primitives available for expert exceptions.

This should not become a general-purpose Figma, Canva, or desktop-publishing clone. OpenLDR should be exceptionally good at designing controlled laboratory and public-health reports.

### Product approaches considered

#### Approach A - polish the existing free-form canvas only

Add rulers, better layers, alignment buttons, copy/paste, and more properties while keeping every item absolutely positioned and leaving PDF Preview as the source of truth.

Advantages: smallest model change; preserves all current templates; fastest visible improvement.

Disadvantages: does not solve the core WYSIWYG mismatch, repeated-coordinate maintenance, pagination uncertainty, or consistency across many reports. Authors still discover important behavior only after rendering.

Verdict: useful as a short-term slice, insufficient as the destination.

#### Approach B - replace free-form design with a component/flow builder

Build reports from ordered sections and locked components that automatically flow and paginate.

Advantages: safer, more consistent, easier to make responsive to data, and better for most standard reports.

Disadvantages: loses the precise page-control users already have; difficult for legacy forms, regulatory layouts, labels, and unusual laboratory formats; would discard substantial good work.

Verdict: too restrictive as a replacement.

#### Approach C - hybrid free-form canvas plus structured components - recommended

Keep absolute placement at the page level, but let an item also be a container or reusable report component with internal layout, bindings, variants, and controlled slots. Add a Live Print canvas that resolves real data and physical pages without making every drag rerun a query.

Advantages: preserves current investment, supports advanced layouts, makes standard reports faster and safer to author, and creates a path to real WYSIWYG parity.

Trade-off: requires a clearer document model and a shared layout plan rather than more one-off React/PDF drawing logic.

## Designer P0 findings - correct before expanding the feature set

### RD-P0-01 - Editing a published template can change live report output through autosave

The designer autosaves a persisted design after 1.2 seconds (`apps/studio/src/report-designer/ReportDesignerPage.tsx:26`, `:159-175`). A published report stores that design's id, and the Reports runtime loads the current design by id every time it runs or renders (`packages/bootstrap/src/index.ts:221-239`). There is no immutable published revision between them.

Impact: an author can move a field, temporarily break a binding, experiment with a colour, or delete an element and have that working edit become the next official report output before review or an explicit republish action. Undo only changes the current editor state; it is not a production rollback mechanism.

Required direction:

- Autosave a **working draft**, never the published revision.
- Publishing creates an immutable, numbered template revision and pins the report definition to it.
- Later edits create a new draft based on the published revision.
- `Publish update` should show preflight results and a visual/textual change summary, then deliberately move the report to the new revision.
- Preserve who created, reviewed, approved, and published each revision, with timestamps and comments.
- Support compare and rollback without overwriting historical output provenance.
- Mark centrally managed/synchronised designs clearly and prevent silent local edits from being overwritten or unexpectedly propagated. Provide `Create local variant` where appropriate.

### RD-P0-02 - The canvas is not a faithful preview of a bound table

The canvas table draws only static `el.columns` and `el.rows` (`apps/studio/src/report-designer/PageCanvas.tsx:292-304`). A real bound table uses `boundColumns` and resolved query rows in the PDF (`packages/report-designer/src/render/draw.ts:691-708`). Once a table is bound, the canvas can therefore appear empty or show stale sample structure while the PDF has a completely different header, width allocation, row count, alignment, striping, status styling, and pagination.

Required direction:

- At minimum, a bound table must show its current `boundColumns` headers on the ordinary canvas.
- Add a data-preview mode that shows a cached sample of real rows, correct formats, status states, and empty/error states.
- Use the same column-width, row-height, overflow, and header logic as PDF layout.
- Show which rows are samples and which physical continuation pages will be created.
- Never let `looks empty on canvas, populated in PDF` remain a normal authoring state.

### RD-P0-03 - The canvas and PDF use different visual implementations

The canvas uses DOM/CSS; the final document uses PDFKit. Their styles are only manually approximated:

- canvas text uses CSS font weight `600`, `leading-tight`, and pixel sizes;
- PDF text uses Helvetica/Helvetica-Bold, PDFKit line metrics, and px-to-point conversion;
- canvas tables use a bordered HTML grid;
- PDF tables use content-measured columns, no vertical grid, zebra rows, fixed 16 pt pitch, numeric alignment, status colours, and bottom rules;
- canvas key/value geometry is a CSS grid approximation;
- PDF key/value geometry uses point constants and clipping;
- canvas does not show PDF page-number chrome.

This is a structural parity risk, not a matter of making the CSS closer by eye.

Required direction:

- Introduce a pure **resolved layout plan** between the design schema and both painters. The plan should contain physical pages, resolved text, font metrics, boxes, column widths, row chunks, status styles, overflow state, and repeat behavior.
- Paint the same plan to the interactive canvas (SVG/DOM/canvas) and PDFKit.
- During a drag, transform the affected box locally for responsiveness. Recompute the layout plan on pointer-up or a short debounce; do not rerun queries while the pointer moves.
- Add automated canvas-versus-PDF visual parity fixtures with tolerances for unavoidable raster differences.

### RD-P0-04 - The Page numbers control is not persisted

`ReportDesignSchema` supports `pageNumbers` and the Properties tab edits it (`packages/report-designer/src/schema.ts:124`; `apps/studio/src/report-designer/PropertiesTab.tsx:402-405`). However, the report-design store's `toRow`, `fromRow`, and content hash omit the field, and the database table has no column for it (`packages/report-designer/src/store.ts:6-38`; `packages/db/src/migrations/internal/042_report_designs.ts`).

Impact: the checkbox can appear to work in the current in-memory preview but is lost on save/reload and cannot synchronise. This likely explains why page numbers are absent from otherwise page-number-enabled seeded output.

Required direction:

- Persist and sync `pageNumbers`, add a store round-trip test, and add a designer save/reload test.
- Audit every schema property for the same schema/store/API/render round-trip gap.
- In the longer-term revision model, keep document chrome inside the versioned design snapshot.

### RD-P0-05 - The Image property invites a source the PDF cannot render

The image Source field suggests `https://…` (`apps/studio/src/report-designer/PropertiesTab.tsx:177-182`). The browser canvas can display such an image, while the PDF renderer explicitly records that PDFKit treats a URL as a file path and falls back to a dashed placeholder (`packages/report-designer/src/render/draw.ts:644-659`). This is a direct WYSIWYG contradiction.

Required direction:

- Replace arbitrary URL entry with an asset picker/upload flow that stores an approved embedded or server-managed asset.
- Validate MIME type, dimensions, file size, and PDF compatibility at selection time.
- Use the same asset resolver for canvas, preview, final report, central sync, and offline lab rendering.
- If remote assets are ever supported, fetch/cache them server-side with explicit security controls; do not let the browser and PDF interpret the same `src` differently.

### RD-P0-06 - `Check` is visible but does nothing

The main menu presents `Check` and `Duplicate`, but both are wired to `noop` (`apps/studio/src/report-designer/ReportDesignerPage.tsx:31`, `:433`). `Check` is especially problematic because it implies a report-quality/preflight safety net that does not exist.

Required direction:

- Until implemented, hide or clearly mark unavailable actions; never ship a silent no-op.
- Implement Check as a persistent preflight panel with errors, warnings, affected page/layer, explanation, and click-to-select/fix behavior.
- Check must include the publication-lint items already listed in the main audit, plus designer-specific parity and binding checks.
- Implement Duplicate with an explicit name, new id, draft status, and clear handling of published/managed templates.

### RD-P0-07 - Query failures are rendered inside a valid-looking PDF instead of blocking publication

The preview route intentionally catches per-table query failures and still returns HTTP 200 with an error placeholder inside a PDF. That is helpful for diagnosis, but a user can potentially continue to export or publish a report-shaped document with a query error.

Required direction:

- Report query and binding errors as structured preflight errors outside the PDF.
- Preview may still visualize the failed region, but Export Final/Publish must be blocked until required errors clear.
- Distinguish design preview, diagnostic PDF, and official/final PDF both visually and in API behavior.
- Record which parameters/data snapshot produced a successful preflight.

## WYSIWYG improvements

### 1. Add two explicit canvas modes

#### Design mode

Fast interactive editing with selection boxes, guides, handles, placeholder/sample data, and no query execution during pointer movement.

#### Live Print mode

A persistent mode in the centre pane, not a modal, that uses the resolved layout plan and a cached data snapshot. It should show actual:

- token values;
- fonts and line breaks;
- table headers and sample rows;
- content-proportional column widths;
- status formatting;
- null/suppression states;
- physical page count and continuation pages;
- repeating masthead/footer;
- page numbers;
- overflow, clipping, and preflight markers.

Let the author toggle modes without losing selection or scroll position. Offer an optional side-by-side comparison on wide screens. Refresh data explicitly or when parameter values change; placement/style edits should reuse the snapshot and only recompute layout.

### 2. Show runtime tokens as authored data, not raw punctuation

The canvas resolves only `{{lab.*}}`; it deliberately leaves `{{param.*}}` and `{{date}}` literal. Raw braces are useful for debugging but poor WYSIWYG authoring.

Required direction:

- Add a token/field picker with searchable categories: Institution, Report, Patient/Request, Parameters, Dates, and bound query fields.
- Render tokens as chips while editing and as sample values in Live Print mode.
- Provide autocomplete and validation rather than requiring exact token syntax.
- Show a tooltip with source, type, sample value, null behavior, and format.
- Keep a raw/expert expression view for advanced authors.
- Separate **preview values** from **production defaults** so sample patient/request identifiers are never accidentally saved as run defaults.

### 3. Make pagination visible and editable

One authored design page can expand into multiple physical PDF pages when a table overflows. The current canvas shows the design page only; its `Page 1 of 1` caption can therefore disagree with the final physical page count.

Required direction:

- Show ghost/derived continuation pages in Live Print mode.
- Mark repeating elements and advancing tables.
- Show row capacity and estimated/actual physical page count on the table.
- Add `Keep with next`, `Repeat on continuation`, `Start on new page`, and safe manual page-break capabilities only where the layout engine can honour them deterministically.
- Warn when a second table on the same design page will repeat header-only after its rows are exhausted.
- Show footer/page-number collision zones before export.

### 4. Add visual overflow and clipping diagnostics

- Draw a warning badge on elements whose text or rows are clipped/ellipsized.
- Offer `Fit height`, `Fit width`, `Grow to content`, and `Show full content` actions where safe.
- Highlight content outside margins or safe print area.
- Show low-resolution images and undersized barcode/QR warnings directly on the element, not only in the inspector.
- Make every warning selectable from the Check panel.

## Layers and page structure

### 1. Replace the flat Layers list with a page tree

The current Layers tab flattens every page and reverses the combined element array (`apps/studio/src/report-designer/LayersTab.tsx:13-36`). It has no page headings, active-page state, rename, z-order editing, visibility, lock, grouping, or warning badges.

Recommended tree:

```text
Document
  Master header
  Page 1
    Report title
    Scope panel
    Results table
  Page 2
    Notes
  Master footer
```

Each row should support:

- editable layer name;
- type/binding icon;
- drag handle for z-order within its page;
- bring forward/back and send to front/back commands;
- lock/unlock;
- show/hide in designer;
- conditional-render status distinct from editor visibility;
- duplicate/delete;
- binding/preflight warning badge;
- click to select and scroll/zoom into view.

Layer names should default intelligently (`Text: Laboratory Report`, `Table: Susceptibility`, `Image: Lab logo`) and remain user-editable. Current inserted elements use generic names and the Properties panel does not expose name editing, so layers quickly become a list of `Text`, `Rectangle`, and `Table`.

### 2. Add complete page management

The schema and canvas can render several authored pages, but the UI has no clear Add page, Duplicate page, Delete page, or Reorder page workflow. Insert always calls `addElement(template, 0, el)`, so new elements go to page index 0 regardless of which page the author is viewing (`apps/studio/src/report-designer/ReportDesignerPage.tsx:249-252`).

Required direction:

- Introduce an explicit active page.
- Insert into the active page.
- Add, duplicate, rename, reorder, and delete pages with confirmation/dependency rules.
- Support moving/copying elements between pages.
- Scope ordinary Select All, layer operations, alignment, and group operations to the active page, with a separate document-wide command.
- Show authored-page count separately from derived physical-page count.

### 3. Add real groups

Multi-selection and group scaling exist, but there is no persistent group in the document model.

Required direction:

- Group selected elements into a named layer that moves, locks, hides, duplicates, and reorders as one.
- Preserve child geometry and allow enter-group/edit-child behavior.
- Do not confuse groups with components: a group is local geometry; a component has reusable structure, slots, variants, and update semantics.

## Reusable components and master regions

### 1. Add a focused component library

Start with components repeatedly needed by the report catalogue:

- Institutional masthead/letterhead
- Report title, subtitle, and document-status block
- Report scope/parameter summary
- Patient and request identity banner
- Specimen metadata panel
- Section heading/band
- Results table with caption and legend
- Organism/result callout
- Methodology/limitations/data-quality note
- Authorization/release block
- Barcode/QR verification block
- Repeating footer with document ID and Page X of Y

Each component should expose only meaningful properties and binding slots while keeping its internal layout protected. For example, a masthead exposes issuer lines, logo, accent variant, and optional accreditation slot; it should not force the author to align six independent text/image primitives every time.

### 2. Support variants rather than duplicated templates

Examples:

- Masthead: ministry + programme; facility; text-only
- Scope: compact two-column; detailed; regulatory
- Results table: clinical comfortable; aggregate compact; regulatory dense
- Authorization: electronic release; wet signature; no signature for draft
- Footer: clinical confidential; aggregate public-health; submission review

Variants should be governed by the document theme and retain compatible bindings when switched.

### 3. Add master header/footer regions

Master regions should repeat across authored and derived continuation pages. Authors need to edit the institutional masthead, footer, and page chrome once.

Required behavior:

- visible and editable in the canvas;
- locked by default to prevent accidental movement;
- tenant/central-managed variants can be read-only to local authors;
- per-template override policy is explicit;
- master height reserves body space and participates in preflight;
- first-page and continuation-page variants are supported where needed.

### 4. Add save-as-component with governance

Allow an author to save a selected group/container as a local reusable component. Separately support centrally managed components distributed to labs.

Every component instance needs an explicit update policy:

- linked - receives compatible component updates;
- pinned - stays on a specific component revision;
- detached - becomes ordinary local elements.

Do not implement "components" as blind copy/paste only; that would create more drift, not less.

## Layout containers and constraints

Absolute placement should remain, but most report interiors should not require manual coordinate arithmetic.

Add three safe container types:

1. **Stack** - vertical or horizontal children with gap, padding, alignment, and optional wrapping.
2. **Grid** - fixed/responsive columns for metadata pairs and summary blocks.
3. **Flow section** - content grows vertically, can split across pages, and reserves header/footer space.

Add child constraints such as fixed, hug content, fill available, min/max size, anchor left/right/top/bottom, and keep aspect ratio. Use simple terms in the UI and show the computed size.

The hybrid rule should be:

- the page and specialised form overlays may be free-form;
- standard document sections use containers/components;
- tables and variable-length content live in flow-aware regions;
- authors can detach or opt into absolute mode when necessary.

This would eliminate many current px/pt height calculations and the need to manually push every downstream element when a metadata panel gains a field.

## Canvas and editing tools

### High-value tools

- Make Insert a visible toolbar/palette action instead of hiding every element under the kebab menu.
- Add a searchable element/component palette with click-to-insert and drag-to-place.
- Add Fit page, Fit width, Fit selection, custom zoom, and 100% print-size commands; current zoom is limited to 50/75/100/125%.
- Add rulers with draggable guides, grid/baseline-grid options, snap toggle, and measurement readouts.
- Show distances between the selection and nearby elements/margins while moving.
- Add align left/centre/right/top/middle/bottom, distribute horizontally/vertically, equal spacing, match width/height, and tidy-grid actions.
- Add copy, cut, paste, duplicate-in-place, `Ctrl/Cmd+D`, and optional Alt-drag duplication.
- Add format painter/copy style and apply named style.
- Add aspect-ratio lock for images, QR codes, and grouped components.
- Add a contextual mini-toolbar near the selection for the most frequent operations; keep the inspector for detailed settings.
- Add a shortcut reference and command palette.

### Lower priority / likely unnecessary initially

- arbitrary rotation;
- freehand drawing or vector pen tools;
- gradients, shadows, filters, and illustration effects;
- animations or interactive PDF widgets;
- unconstrained plugin-authored canvas behavior.

These do not materially improve Ministry laboratory reports and would dilute the product.

## Inspector improvements

### 1. Separate document, component, element, and data properties

The current three tabs are understandable, but selection state changes their meaning. Consider a clearer inspector hierarchy:

- Document - paper, margins, masters, theme, locale, document control
- Layout - x/y/w/h, container constraints, align/distribute
- Style - typography, fill, border, spacing, table variant
- Data - binding, fields, formats, conditions, preview values
- Layers/Structure - page tree and components

This can remain one right pane; the improvement is information architecture, not more permanent columns.

### 2. Expand typography and style controls through named roles

Do not merely add dozens of raw fields. Let an element use a style role such as `Report title`, `Metadata label`, or `Table body`, then allow a controlled override.

Needed authoring controls include:

- font family/approved fallback;
- weight, italic, size, line height, letter spacing;
- horizontal and vertical alignment;
- padding and gap;
- text wrap, truncate, fit, or grow behavior;
- border sides/style/radius where appropriate;
- theme colours, recent colours, and tenant brand palette;
- contrast and print-legibility warning.

The current fixed colour swatches are generic application colours, not a document theme (`apps/studio/src/report-designer/ColorField.tsx`).

### 3. Give tables a real inspector

Bound tables currently return no kind-specific Properties controls; most visual behavior is hard-coded. Add:

- style/density variant;
- header and body typography;
- row height or wrap mode;
- zebra/group-rule options;
- column format, kind, alignment, width/min/max, wrap, status source, and emphasis;
- table caption, grouped headers, row grouping, sort display, legend, and continuation label;
- empty/null/suppressed-state display;
- repeat-header and page-split behavior;
- transpose toggle and first-column label.

The schema already contains `transpose`, `transposeLabel`, column `kind`, and parameter `required`, but the ordinary designer UI does not expose all of them. A seeded/template-coded capability that cannot be authored in the page is a product gap.

## Data-bound authoring

### 1. Make Data mode data-first, not query-id-first

Authors should be able to:

- choose a query/dataset and see its fields, types, samples, and parameter requirements;
- drag a field to create a text value, key/value pair, table column, barcode, QR, or image binding;
- drag a dataset/table to create a sensible default table;
- see where each query is used on the page;
- see readiness/error state without running a full PDF preview.

Keep Custom Query as the powerful source, but present a report-friendly field browser above its implementation details.

### 2. Add single-value bindings

Current binding is limited to table, key/value, barcode, and QR elements. Add source-backed single-value bindings for text, date/time, and image where safe. This removes the need to create a one-pair panel or special token for every data value.

Each binding needs:

- field and row/aggregation rule;
- format;
- null fallback;
- conditional visibility;
- sample value;
- error behavior;
- source/binding traceability.

### 3. Improve parameter authoring

The current parameter editor depends on exact `design parameter key == query parameter id` matching. It supports a `select` type but does not author its options source here, and it does not expose the schema's `required` flag.

Required direction:

- Show query parameter requirements and map them explicitly.
- Validate missing, extra, and type-mismatched parameters immediately.
- Expose required/optional, default, label, help text, option source, all-value semantics, date rules, and validation.
- Keep preview test values in a separate named preset, not in production defaults.
- Allow saved preview presets such as `Typical`, `No data`, `Longest names`, and `Maximum rows`.
- Mask or use synthetic patient data by default when previewing clinical templates.

### 4. Detect schema drift

If a bound query removes or renames a column, the designer should show the affected element/layer and block publication as appropriate. `Load columns` should not be the only way an author discovers drift.

Add binding-health states:

- Ready
- Query unavailable
- Missing field
- Type changed
- Required parameter missing
- Empty sample
- Query error
- Stale preview snapshot

## Template explorer and authoring workflow

The initial approved design called for search and a visible New template action; the current `TemplatesExplorer` is only a flat list (`apps/studio/src/report-designer/TemplatesExplorer.tsx`). The translation catalogue still contains unused search/no-results copy.

Required direction:

- Add search, New template, sort, filters, and meaningful empty state.
- Filter by report type/category, owner, status, published/draft, local/central-managed, paper/orientation, and recently edited.
- Add favourites/recent templates before adding complex folders.
- Show badges for Draft, Published vN, In review, Managed centrally, Has errors, and Used by N reports.
- Show last editor and accurate modified time.
- Add starter templates/components rather than starting every report from a blank page.
- Provide dependency-aware archive/delete. A design used by a published report must not disappear without an explicit replacement/unpublish workflow.
- Implement Duplicate as a first-class branch/variant action.

## Collaboration, concurrency, and governance

For Ministry use, template design is controlled content rather than an ordinary personal canvas.

Required capabilities:

- optimistic concurrency or edit-session locking so two authors cannot silently overwrite one another;
- presence/read-only indication when another user is editing;
- conflict resolution based on revisions, not last-write-wins autosave;
- template ownership and central/local management status;
- review/approval roles separate from editing rights;
- comments or review notes attached to a revision/element;
- audit history that can reconstruct the published revision;
- change summary and rendered before/after comparison;
- rollback and deprecation/archive instead of destructive deletion;
- publish notes and effective date where a coordinated rollout is required.

Autosave is still valuable; it should protect the draft, not bypass governance.

## Accessibility and responsive authoring

The page has useful keyboard shortcuts and accessible inspector controls, but canvas manipulation remains pointer-heavy. Resize handles are pointer spans, layer rows cannot yet expose all operations, and a `role="button"` canvas element does not itself provide a complete keyboard interaction model.

Required direction:

- Make every canvas element selectable through a structure/layers tree without a mouse.
- Provide keyboard move, resize, z-order, lock, hide, group, and align operations.
- Give handles or equivalent inspector controls proper names and focus behavior.
- Announce selection, position/size changes, snapping, warnings, and save state to assistive technology.
- Ensure zoom does not make handles unusably small/large.
- Preserve click-to-insert alternatives to drag-and-drop.
- Treat phone layouts primarily as review/light-edit surfaces; complex page composition should be optimized for a sufficiently large viewport rather than pretending a phone can offer full desktop precision.

## Recommended ideal workflow

1. Author selects a starter template or creates a blank draft.
2. Author selects an approved document theme and institutional master.
3. Author chooses data source(s), maps parameters, and selects a masked/synthetic preview preset.
4. Author drags report components or fields onto the active page, using containers for variable content.
5. Design mode handles fast placement; Live Print mode shows the real resolved pages using the same layout plan as PDF.
6. Layers/Structure exposes page, component, child, lock, visibility, binding, and warning state.
7. Check produces a navigable preflight report; errors block publication and warnings require review/acknowledgement according to policy.
8. Save/autosave protects the working draft.
9. Review shows before/after rendered output and structured changes against the published revision.
10. Publish creates an immutable revision and explicitly updates the linked report.
11. Future generated reports record the exact template revision, query/version, parameters, and generation metadata.

## Recommended delivery order for Designer improvements

### Phase 0 - correctness and trust

1. Persist `pageNumbers` and audit all schema/store round trips.
2. Wire or remove Check and Duplicate.
3. Reject/integrate image sources consistently across canvas and PDF.
4. Show bound table headers on canvas.
5. Block final publish/export on query/binding/preflight errors.
6. Separate autosaved working drafts from immutable published revisions.
7. Add dependency-safe archive/delete and concurrent-edit protection.

### Phase 1 - real WYSIWYG foundation

1. Create the shared resolved layout plan.
2. Add cached sample-data snapshots and explicit preview presets.
3. Build persistent Live Print mode from the shared plan.
4. Visualize derived physical pages, repeated elements, clipping, and overflow.
5. Add automated canvas/PDF parity fixtures.

### Phase 2 - pages, layers, and daily editing

1. Active page and complete page management.
2. Page-aware layer tree with rename, reorder, lock, hide, duplicate, and warnings.
3. Copy/paste/duplicate, align/distribute, rulers/guides, fit zoom, and measurement feedback.
4. Searchable Insert/component palette and keyboard command list.

### Phase 3 - components and layout

1. Master header/footer regions.
2. Stack, grid, and flow containers.
3. Core health-report component library and variants.
4. Save-as-component, linked/pinned/detached instance behavior.
5. Named document theme and style roles.

### Phase 4 - advanced data and governance

1. Field browser and drag-to-bind.
2. Single-value bindings, formatting, conditions, and schema-drift detection.
3. Rich table authoring and grouped headers/rows.
4. Review comments, approvals, change comparison, rollout, and rollback.

## Designer acceptance criteria

### WYSIWYG parity

- A bound table shows the same headers, column proportions, row styles, status states, and sample values on Live Print canvas and PDF.
- Text line breaks and clipping match the PDF within an approved visual tolerance.
- Canvas and PDF use the same resolved tokens and asset pipeline.
- The editor displays the actual physical page count for the selected preview data.
- Page-number, footer, repeating-header, and continuation behavior is visible before export.
- A canvas-versus-PDF golden suite covers every element/component and reports regressions.

### Pages and layers

- Insert targets the active page.
- Pages can be added, duplicated, reordered, and safely removed.
- Layers are grouped by page/master and can be renamed, reordered, locked, hidden, duplicated, and selected.
- Z-order on the canvas, layer tree, saved design, and PDF are identical.
- Groups and components are visibly distinct and behave according to their model.

### Components

- An author can build a new standard clinical/aggregate report primarily from approved components without hand-aligning every element.
- Updating a linked component preserves documented bindings/overrides and shows a change preview.
- Pinned/detached instances remain unchanged.
- Master header/footer changes propagate to all pages and continuation pages without collision.

### Data authoring

- Every binding shows source, field, format, sample, null behavior, and health state.
- Query/parameter schema drift is detected automatically.
- Preview values are separate from production defaults.
- Empty, long, error, and maximum-row preview presets are available.
- Clinical preview defaults do not expose real patient data unnecessarily.

### Governance

- Autosave never changes the currently published revision.
- A report render records the exact design revision used.
- Publish requires a successful preflight and explicit action.
- Reviewers can compare draft and published output.
- Two editors cannot silently overwrite each other.
- Deleting/archiving a design cannot create a dangling published report.

### No false affordances

- Every visible action performs its stated function or is visibly disabled with an explanation.
- A property accepted by the canvas is persisted, previewed, rendered, exported, and synchronised consistently.
- Save/reload round-trip tests cover every design/document/element property.

## Designer-specific verification matrix

| Area | Required cases |
|---|---|
| Canvas/PDF parity | every element; every component; long text; empty text; each zoom; each paper/orientation |
| Bound data | normal; empty; error; null-heavy; status-filled; long fields; transposed; schema changed |
| Pagination | one page; derived continuations; several authored pages; multiple tables; final short page |
| Layers | rename; reorder; lock; hide; group; component; move across pages; undo/redo |
| Components | linked update; pinned version; detach; missing binding; central-managed/local variant |
| Assets | uploaded PNG/JPEG; transparent logo; invalid MIME; oversized; remote URL; offline/synchronised lab |
| Persistence | every schema field create/get/update/list/sync; save/reload; duplicate; revision publish/rollback |
| Concurrency | two editors; stale autosave; conflict; read-only reviewer; central/local ownership |
| Preflight | each error/warning; click-to-select; blocked publish; acknowledged warning; successful publish |
| Accessibility | keyboard select/move/resize/reorder; screen-reader announcements; focus at all zoom levels |

## Things not to do in the Designer work

- Do not call a slightly closer CSS approximation "true WYSIWYG" while the canvas and PDF still compute layout separately.
- Do not execute a live clinical query on every drag/keystroke; cache the preview dataset and recompute layout separately.
- Do not replace the free-form canvas with a rigid component-only builder.
- Do not implement components as copied element bundles with no revision/update semantics.
- Do not add dozens of ungoverned style controls before introducing themes and roles.
- Do not let preview test values become production parameter defaults accidentally.
- Do not leave silent no-op menu actions visible.
- Do not let autosave update published output directly.
- Do not add desktop-publishing decoration features before pages, layers, components, parity, preflight, and governance are sound.

## Addendum final assessment

The Report Designer should be evolved, not replaced. Its current free-form canvas, interaction model, and query/PDF pipeline are valuable. The largest improvement will not come from adding more basic element types; it will come from making the canvas show the same resolved document that will print, then giving authors reusable health-report components and controlled publication revisions. Better layers are important, but **WYSIWYG parity + draft/publish safety + components** should be the centre of the next design phase.
