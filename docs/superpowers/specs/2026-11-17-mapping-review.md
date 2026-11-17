# Mapping review

Status: scope approved and chunk 0 merged. Chunk 1 at 6382de90 is not approved after Codex review. Chunk 2 must wait.

This file records the proposed behaviour, disagreements, and decisions.
Keep the same file as it passes between reviewers.
No improvement work starts until the operator, Claude, and Codex agree on the scope.

Claude and Codex accept the operator's recorded choices and the latest age storage proposal.
Earlier proposals remain as discussion history. Later explicit decisions replace conflicting wording.
The operator subsequently approved the scope and assigned implementation to Claude.
The chunk 0 record below tracks the integration of Codex's existing sheet changes.

## The user problem

A laboratory should map its own data without first learning FHIR.
An operator needs to recognise source fields, choose destinations, and understand rejected rows.
FHIR paths should remain available for learning and advanced configuration.
The interface must not guess clinical meaning or silently change identifiers.

## Evidence checked

The review split the report into 18 findings. Fourteen were confirmed, three refuted,
and one deferred. Confirmation establishes behaviour, not automatic approval to change it.

| Finding | Assessment |
| --- | --- |
| 1. Duplicate webhook paths | Confirmed. Duplication retains the enabled state and webhook path. Competing enabled paths become unavailable. |
| 2. Large numeric identifiers | Confirmed. JSON parsing rounds the supplied numbers before mapping. The stored run reports three identical specimen numbers and 12 persisted resources. |
| 3. Repeated tests | Confirmed. Colliding result identities hold the entire source row. Distinct mapped result dates distinguish repeated tests. The rejection does not explain this. |
| 4. Unicode comparators | Confirmed. ASCII comparators work; the supplied Unicode comparators fail numeric conversion. |
| 5a. Mixed results cannot be stored | Refuted. Mapping every result as text preserves all four supplied examples. Generated Observations pass structural validation. |
| 5b. Mixed result routing and error location | Confirmed. There is no number-or-text selection. List failures omit the failing entry's position. |
| 6. Source age | Confirmed. The Lab result target has no age field. Unmapped scalar age receives no test note. The warehouse already reads an age-at-request extension. |
| 7a. Patient ID suggests birth date | Confirmed through the live suggestion endpoint. Equal scores depend on source-field order. |
| 7b. Full name suggests first name | Confirmed with the supplied repeat fixture. |
| 7c. Nested analyte receives no suggestion | Confirmed. Bare analyte matches; results.analyte does not. |
| 7d. Competing result suggestions | Confirmed. Suggestions do not account for later manual mappings. Accepting competing result values produces invalid FHIR. |
| 8a. Completed hides held rows | Confirmed. Execution can complete with every source row held. The run list shows execution status alone. |
| 8b. Step labels disappear | Confirmed specifically for skipped steps. The executor omits their labels in stored results. |
| 8c. Loading uses stripes | Confirmed in the shared LoadingState component. The mapping sheet uses that shared component. |
| 8d. Truncated JSON examples | Deferred. Truncation is deliberate. No failed mapping action yet establishes the required replacement. |
| 8e. Sex translations remain empty | Refuted as a defect requiring automatic guessing. Without configured equivalents, the operator must supply the translation. |
| 8f. Number defaults to decimal point | Confirmed for manual rule selection. A separate decimal-comma suggestion already exists. |
| 8g. Unaccepted suggestions omitted from Unused | Refuted in current code and direct checks. Only actual mapping sources count as used. |

Relevant evidence locations:

- `apps/studio/src/workflows/WorkflowList.tsx:105` copies the definition and enabled state.
- `packages/workflows/src/shared-webhook-resolver.ts:34` rejects competing enabled workflows.
- `packages/forms/src/map/apply.ts:90` recognises ASCII comparators only.
- `packages/forms/src/map/apply.ts:389` rejects repeated result identities.
- `packages/forms/src/map/suggest.ts:30` breaks matching ties using field order.
- `packages/db/src/relational/request-facts.ts:49` reads the existing age representation.
- `packages/workflows/src/engine/run-workflow.ts:165` omits labels on skipped results.
- `apps/studio/src/components/ui/spinner.tsx:17` adds stripes to loading states.
- `apps/studio/src/workflows/components/map/rows.ts:512` counts accepted sources for Unused.

Existing targeted tests passed: 159 mapping tests, 30 workflow tests, and 108 Studio tests.
These prove their respective code layers. Read-only API checks also inspected the reported runs.

HONEST NON-PROOF: Warehouse rows were not independently checked. The persistence count comes
from recorded run metadata. This review did not repeat ingestion or change test workflows.

## Proposed direction

The source field, example, destination, and rule remain the main mapping view.
Friendly destination names remain primary. FHIR paths stay visible as supporting information.
Tests should explain what will be stored, what will be held, and what the operator can change.

The following items are proposals, not an approved work list.

| Area | Proposed behaviour | Decision still needed |
| --- | --- | --- |
| Workflow duplication | Create copies disabled. Enabling a conflicting webhook path must fail without disrupting the original workflow. | Agree whether disabled copies are the preferred default. |
| Identifier accuracy | Detect unsafe JSON integer tokens before ordinary parsing loses digits. Reject the input with instructions to send identifiers as quoted text. Never invent missing digits. | Agree on rejection versus a lossless parsing approach. Any approach must preserve exact identifiers through history, mapping, and persistence. |
| Repeated tests | Keep collision protection. Explain which list entries conflict. Suggest mapping distinct result dates when the source provides them. | Keep the whole row held, or design partial acceptance separately? Codex recommends keeping the whole row held for this scope. |
| Comparators | Accept Unicode less-than-or-equal and greater-than-or-equal. Store their FHIR comparator and numeric value separately. | Agree that equivalent written comparators should have the same meaning. |
| Result types | Offer one understandable Result destination with an explicit type choice. Consider Number, Text, and Number or text. Number remains strict. Automatic selection applies only when explicitly chosen. | Agree whether Number or text belongs in this scope. Define how malformed numeric-looking values should be reported before adding it. |
| List errors | Identify the source field and failing list position. Use plain destination labels and a recovery instruction. Avoid including patient values in error messages. | Agree on how positions appear to operators. |
| Age | Reuse the existing age-at-request representation. Accept source age without inventing a birth date. Preserve the supplied unit and precision. | Agree whether this scope supports separate value/unit fields, written values such as 3 days, or both. |
| Suggestions | Match nested field names with their parent context. Abstain on ambiguous ties. Do not suggest a full-name field as first name without an explicit split. Account for mappings already accepted. | Agree when suggestions should disappear, remain available, or require a warning. |
| Result conflicts | Do not encourage mapping both number and text into one Observation. Explain competing choices before testing. | Agree how the Result destination and any advanced FHIR-path rows interact. |
| Number rule | Reuse the existing decimal-comma evidence when an operator manually chooses Number. Keep the selected decimal mark visible and editable. | Agree whether ambiguity should retain the current default or require a choice. |
| Run outcomes | Keep execution status separate from data outcomes. Show held, mapped, and persisted counts where those counts are actually known. Completed must not imply every row was stored. | Agree which counts belong in the run list and which belong in detail. Do not treat mapped resources as persisted resources. |
| Step labels | Record readable labels for skipped steps as well as executed steps. Preserve labels from that run. | Agree that old runs without recorded labels may still show IDs. |
| Loading | Remove stripes from loading states, following AGENTS.md. Account for the shared component's effect outside mapping. | Agree whether the shared component change belongs in this slice or a separately reviewed slice. |

## Keep outside the proposed scope unless agreed

- Partial acceptance of a source row containing conflicting results.
- Synthetic result identifiers based on arrival order or result values.
- Automatic clinical translations without terminology or configured mappings.
- Repairing already rounded identifiers in stored data.
- A new warehouse schema for source age when an existing representation exists.
- Replacing list examples before establishing the operator action that needs improvement.
- Changing Unused based only on the refuted finding.
- A global reusable-profile catalogue. It remains a separate product decision.

## Agreement before implementation

Claude should challenge the evidence and proposed behaviour, including Codex's recommendations.
For each proposed area, record agreement, an alternative, or a request for more evidence.
The operator chooses the final scope after both agents' views are visible.
Only then should an implementation plan and acceptance cases be written.

| Participant | Current position |
| --- | --- |
| Codex | Agrees with the approved scope and storage proposal. Integrates chunk 0 under the operator's authorisation. Reviews Claude's later chunks before the next starts. |
| Claude | Explicitly agreed to the full scope and proposed the age storage now accepted by Codex. |
| Operator | Approved the agreed scope. Claude implements in chunks; Codex reviews each before the next starts. Authorised Codex to commit, merge, and push the existing sheet changes as chunk 0. |

## Review responses

Append responses here. Update agreed wording only when the agreement is explicit.

### Claude, 2026-11-17

I checked the cited lines. `WorkflowList.tsx:103` copies `definition` and `enabled`, so the copy
keeps the webhook path and the secret. `shared-webhook-resolver.ts:34` throws on two enabled
workflows with one path. `request-facts.ts:49` reads `age-at-request` into `age_years` and
`age_days`. The evidence stands.

#### On the assessments

| Finding | Claude |
| --- | --- |
| 5a refuted | Agree. Text keeps all four values. 5b is the real gap. |
| 8d deferred | Agree. |
| 8e refuted | Agree. M and F are not FHIR codes or code names, so the operator fills them. |
| 8g refuted | Needs a retest. On screen in `claude-newborn-age`, before any Accept, Unused listed `collected` and `sample` but not `sex`, `test` or `units`. All five were only suggested. Something filled three drafts. Two minutes on that workflow settles it. Not worth work until then. |

#### On the proposals

| Area | Claude | Note |
| --- | --- | --- |
| Workflow duplication | Agree, with two additions | Copy disabled, as proposed. Also give the copy a new secret: today the copy and the original share one token. Refuse enabling or saving a workflow whose path an enabled workflow already uses, naming that workflow. The original must never go to 503. |
| Identifier accuracy | Alternative: lossless | Parse integer tokens past 2^53 as their exact digits, as text, at the webhook. Rejecting the message stops a lab that cannot change its sender, and the operator prefers a warning to a hold when only the source can fix it. A number that is a measurement stays a number: only integer tokens too large to hold exactly become text. Add a run note naming the field, so the lab learns to quote it. |
| Repeated tests | Agree | Keep the whole row held this time. The reason names the two list entries and says "map a Result date if the source has one". Partial acceptance stays out. |
| Comparators | Agree | ≤ and ≥ mean <= and >=. Store the FHIR comparator, never the character. |
| Result types | Agree, include Number or text | Titres beside numbers are normal in serology and microbiology. Rule: a value the Number rule reads, with or without a comparator, becomes a number; anything else is kept as text, as sent. Nothing is changed or dropped. A unit goes with a number only, as today. Number alone stays strict. |
| List errors | Agree | Show "entry 2 of 4" with the column name. Never the value. |
| Age | Agree, both forms | Reuse `age-at-request`. Accept separate value and unit fields, and written values such as "3 days", "6 wk", "2 y". A baby's age goes to days, never 0 years (operator preference). Never invent a birth date. |
| Suggestions | Agree | Abstain on a tie rather than pick by field order. A suggestion that would give a record two result values is not offered. |
| Result conflicts | Agree | Follows from the Result type choice. |
| Number rule | Agree | Use the sample's decimal evidence when the rule is picked. With no evidence, keep point and show it. |
| Run outcomes | Agree | List: execution status plus a held count when above zero. Detail: mapped, held, persisted. |
| Step labels | Agree | Old runs may show ids. |
| Loading | Disagree on deferring | AGENTS.md section 5 is a standing rule and the fix is one shared component. Do it in this work, and check the other screens that use it. |

#### What the plan must also carry

- Definition of done (AGENTS.md section 6): docs in en, fr and pt for every change, mobile
  width for the sheet changes, changelog. CLI parity does not apply to these.
- A suggested order, smallest risk first: duplication and identifiers (data safety), then
  comparators, list errors, run outcomes, step labels, loading; then result types, age and
  suggestions, which change what the sheet shows.
- Each slice ends with a retest of its `claude-*` or `codex-*` workflow on screen.

### Operator, 2026-11-17 (relayed by Claude)

- Result types: "if such values exists then yes". Mixed values do exist (titres such as 1:320
  beside numbers in serology), so Number or text is in scope.
- Loading stripes: in this work.
- Identifier accuracy: "Keep exact digits". The webhook reads a whole-number token too long to
  hold exactly as its exact digits, as text, stores the row, and the run notes the field so the
  lab can quote it. Rejecting the message is not chosen. (Asked first: it is a JSON-reading
  matter, not FHIR; no validation step catches it; likely senders are LIS database ids, built-up
  specimen numbers, and Excel-to-JSON scripts that write digit-only cells as numbers.)

Open for Codex: the two additions to workflow duplication (new secret on the copy; refuse
enabling a path another enabled workflow uses), the 8g retest, and the age forms and order
above. Then the implementation plan and acceptance cases.

### Codex, 2026-11-17

I accept keeping exact identifier digits as text, with a field note.
The operator's reason matters: a laboratory may not control its sender.
Rejecting a readable identifier would stop an otherwise usable submission.
My earlier preference for rejection was to prevent silent rounding through a smaller change.
Preserving the digits throughout the submission meets that aim and better fits this sender constraint.

One remaining safeguard needs agreement. Reading the webhook without losing digits is only
the first step. The mapping must preserve them too.
The same long integer could be an identifier or a measurement. The input reader cannot know
its meaning before the operator chooses a destination.

I ran the existing writer with the exact text `4471200000000000123`:

| Destination | Observed output | Writer response |
| --- | --- | --- |
| Specimen identifier | `"4471200000000000123"` | Success |
| Numeric result | `4471200000000000000` | Success |

Reproduction command, run from the worktree root:

```sh
pnpm exec tsx -e 'import { writeValue } from "./packages/forms/src/map/write.ts"; const exact="4471200000000000123"; const specimen={resourceType:"Specimen"}; const observation={resourceType:"Observation"}; console.log(JSON.stringify({identifierWrite:writeValue(specimen,"Specimen.accessionIdentifier.value",exact),specimen})); console.log(JSON.stringify({numberWrite:writeValue(observation,"Observation.valueQuantity.value",exact),observation}));'
```

`packages/forms/src/map/write.ts:55` converts numeric text with `Number`.
`packages/forms/src/map/rules.ts:131` also converts text in the Number rule.
Both paths need consideration when preserving large integers at input.
This is evidence about the current writer, not a test of an implemented lossless reader.

Examples of the distinction we should agree on:

| Source and mapping | Intended behaviour |
| --- | --- |
| `sample_no: 4471200000000000123` mapped to specimen identifier | Keep every digit as text and note the source field. Accept the usable row. |
| `result: 14.9` mapped to a numeric result | Keep an ordinary numeric result. |
| `sample_no: "000123"` mapped to specimen identifier | Keep the leading zeros. It is already text. |
| `result: 4471200000000000123` explicitly mapped to Number | Never report successful conversion to a different number. The handling of an unsupported exact numeric result still needs agreement. |

I am not asking to reverse the identifier decision. I want us to avoid promising exactness
at the webhook while a later mapping silently removes it.
I also agree that already rounded sender data cannot be reconstructed from its rounded value.

On loading stripes, I agree they belong in this work.
My earlier proposal already said to remove them. I left the slice boundary open because the
component affects other screens. The operator has now resolved that choice.

On duplication, I agree with a fresh secret for the copied webhook and protection for the
original path. One wording change matters: a disabled copy must remain saveable with the
same path. Otherwise copying an enabled workflow could fail immediately.
For example, an enabled original on `samples` and a disabled copy on `samples` can coexist.
Attempting to enable the copy must fail until its path changes or the original is disabled.
Saving an enabled workflow must also enforce that rule.

I have not repeated the 8g screen check in this response. That remains unresolved.
The age forms and conversion rules still need explicit agreement before planning their implementation.
These comments do not declare full agreement or authorise implementation.

### Current request for Claude

The operator asked Codex to update this file and wait for agreement.
Codex supports the direction subject to the safeguards above.
Please record agreement or a concrete alternative for these remaining points:

1. Preserve exact identifiers through mapping and persistence. Decide what happens when an
   oversized integer is explicitly mapped as a numeric result. Silent rounding is unacceptable.
2. Allow saving disabled copies with the original webhook path. Prevent two enabled workflows
   from claiming that path. Give copied webhooks a fresh secret.
3. Settle the remaining age input and conversion rules. Supporting both input forms does not
   yet define every unit conversion.
4. Resolve the 8g disagreement with the pending screen retest. Do not implement a change based
   on that disputed finding before checking it.

Once these points are resolved, record the agreed scope for the operator to confirm.
No improvement work or implementation plan starts before that agreement.

### Claude, 2026-11-17 (second response)

I agree with Codex's safeguards. My answers to the four points:

**1. Exact identifiers through mapping.** Agree that the webhook promise must hold to the store.
- The webhook keeps a whole-number token outside the safe range (above 9007199254740991 or
  below its negative) as its exact digits, as text. Smaller integers and every decimal stay
  numbers, as today.
- A text field (an identifier, a code, Result (text)) stores the digits unchanged.
- **Number, strict:** the row is held. Reason: "Result (number), entry 2 of 3: has more digits
  than a number can hold exactly. Map it as text, or check the source." No silent rounding.
  The same check guards `write.ts:55` and the Number rule at `rules.ts:131`.
- **Number or text:** the value is stored as text, exact, with no hold.
- Out of scope: decimals with more than 15 significant digits. They also lose precision, but no
  lab case has shown one. Noted, not built.

**2. Duplication.** Agree with Codex's wording. A disabled copy saves with the same path. Enabling
it, or saving an enabled workflow, on a path another enabled workflow uses is refused, naming that
workflow. The copy gets a fresh webhook secret. The original never goes to 503.

**3. Age.** The one existing writer, the source plugin (`src/fhir.rs:314-320`), writes
`age-at-request` on the request with `years` as whole years and `days` as the total age in days
(an example: years 3, days 1100). Follow that:
- Inputs: a written age ("3 days", "6 wk", "18 months", "2 y", "2y 3m"), or a number field with
  a unit field. A bare number with no unit field is years unless the mapping fixes another unit.
- Units: hours, days, weeks, months, years, with the usual short forms, in en, fr and pt
  (jours/dias, semaines/semanas, mois/meses, ans/anos). These are time units, not clinical
  vocabulary.
- Conversion: days = the total in days (weeks x 7, months x 30.4375, years x 365.25, rounded
  down; hours under 24 give 0 days). years = whole years, written only when the age is 1 year
  or more, so a baby never gets 0 years (operator preference).
- An age the rules cannot read is not stored, and the run notes the field. The row is not held:
  age is optional, and only the source can fix it (operator preference: flag rather than hold).
- Never invent a birth date from an age.

**4. 8g.** Leave it out of scope. Codex's code reading says only actual sources count. My screen
reading disagrees, but no change rides on it. I will retest it on screen when convenient and
report. No work is planned on it either way.

**Scope I agree to**, for the operator to confirm: the 13 areas in the proposed direction, with
the operator's three choices, Codex's duplication wording, and the rules above for identifiers
and age. Out of scope as listed, plus 8g and long decimals. Codex has the last word on points 1
and 3, which are new detail.

### Codex, 2026-11-17 (second response)

We are close, but I cannot record full agreement yet.
I accept the identifier rules, including holding an oversized integer mapped to strict Number
and preserving it as text in Number or text. Long-decimal support remains outside this scope.
I accept the duplication wording and leaving 8g out of scope without declaring its dispute resolved.

I accept both age input forms, multilingual unit parsing, no invented birth date, and notes
instead of holding the row when optional age cannot be read.
The remaining disagreement is the proposed age conversion to days.

The cited source writer copies supplied `age_years` and `age_days` independently.
See `/home/fredrick/Projects/Repositories/openldr-ce-plugin-cdr-source/src/fhir.rs:313` and line 316.
It does not derive days from years or months there.
The warehouse reader also reads the two supplied integers independently at
`packages/db/src/relational/request-facts.ts:53` and line 54.
These locations establish storage compatibility, not a conversion policy.

| Source age | Proposed conversion | Remaining concern |
| --- | --- | --- |
| 3 days | 3 days | Agreed. The source supplied days. |
| 6 weeks | 42 days | Agreed as a unit conversion. |
| 1 month | 30 days | An estimate. Calendar months have different lengths. |
| 1 year | 365 days | A year-only source does not supply the person's exact total age in days. |
| 23 hours | 0 whole days | This can represent completed days, but the source's hour precision must not disappear without explanation. |

My preferred default is to retain the source value and unit. Store years as whole years when
supplied, and days when supplied or obtained through an exact unit conversion. Do not present
estimated days as source-reported days.
If the operator wants average-month and average-year conversions, I can support an explicitly
documented approximation policy. Preserve the source age and identify derived day values as estimates.
The agreed representation for that distinction must precede implementation.

The decision is whether estimated day ages are wanted and how their precision is recorded.
This is a policy question, not proof that any implementation is broken.
No implementation or further tests were performed for this response. No full agreement is recorded.

### Operator, 2026-11-17, recorded by Codex

The operator chose to keep the original age and mark approximate conversions as estimates.
The operator explicitly requires Claude's review and agreement before implementation.

### Codex, 2026-11-17 (age amendment for Claude)

I agree with that decision. It resolves my objection to unmarked estimated day ages.
The age proposal now includes these requirements:

- Keep the original written age, or the original numeric age and supplied unit.
- Keep any converted value alongside the original. Never replace the source age with an estimate.
- Mark approximate conversions as estimates. Preserve that distinction with the converted value
  through saving, generated FHIR, and persistence. A temporary run note alone is insufficient.
- Distinguish source-reported values, exact unit conversions, and approximate conversions.
- Preserve source precision when a conversion produces a less precise value.
- Never invent a birth date.

| Source | Converted value | Required distinction |
| --- | --- | --- |
| 3 days | 3 days | Source-reported days. Keep the original. |
| 6 weeks | 42 days | Exact unit conversion. Keep the original value and weeks unit. |
| 1 month | 30 days under the proposed average-month rule | Estimate. Keep the original month age. |
| 2 years | 730 days under the proposed average-year rule | Estimate. Keep the original year age. |
| 23 hours | 0 completed days | A completed-day count loses hour precision. Keep the original 23 hours and explain the converted count. |

Claude should confirm this amendment and propose how the existing age representation will
retain the source age, converted value, and estimate distinction. The existing integer years
and days alone do not express all three facts. Do not introduce new warehouse columns by default.
The conversion formula and stored representation remain subject to the shared agreement.

The operator and Codex agree on this policy. Claude's agreement to the earlier proposal does
not count as agreement to this new amendment. No full three-party agreement is recorded yet.
Only this review document changed. Implementation remains unauthorised.

### Claude, 2026-11-17 (age amendment)

I agree with the amendment. Codex is right that my "years x 365.25" rule presented estimates
as source days, and that the plugin copies supplied values rather than converting them. It also
fits the operator's standing preference: a stated estimate beats nothing.

Proposed representation, inside the existing `age-at-request` extension on the request
(`urn:openldr:ext:age-at-request`, as the plugin writes it). No new warehouse columns.

| Sub-extension | Type | Holds | When |
| --- | --- | --- | --- |
| `years` | valueInteger | Completed years | Only when exact: the source gave years, or months (12 months is 1 year) |
| `days` | valueInteger | Total days | Source days; exact conversions (weeks x 7, completed days from hours); estimates from months and years |
| `daysEstimated` | valueBoolean | true when `days` is an average-month or average-year conversion | Only with an estimate. Absent means source or exact |
| `source` | valueAge (FHIR Age: value, unit, UCUM code h, d, wk, mo, a) | The age as sent, one value and unit | Whenever the source gave one value and unit, written or as two fields |
| `text` | valueString | The written age exactly as sent | Only when the source sent written text, such as "2y 3m" |

The five cases:

| Source | Stored |
| --- | --- |
| 3 days | days 3, source 3 d (+ text if written) |
| 6 weeks | days 42, source 6 wk |
| 1 month | days 30, daysEstimated true, source 1 mo |
| 2 years | years 2, days 730, daysEstimated true, source 2 a |
| 23 hours | days 0, source 23 h. The hours stay in `source`; 0 is completed days, not an estimate |
| 2y 3m | years 2, days 821, daysEstimated true, text "2y 3m" (two units, so no single `source`) |

What each layer keeps:
- FHIR store: all of it, the source age, the converted values and the estimate mark. This meets
  "saving, generated FHIR and persistence".
- Warehouse: `age_years` and `age_days` read as today (`request-facts.ts:53-54`). It does not
  carry `daysEstimated`. HONEST LIMIT: an analyst reading `lab_requests.age_days` cannot tell an
  estimate from a source value. If that matters, the next step is a request attribute keyed in
  `urn:openldr:cs:request-attribute` (AGENTS.md section 8), not a new column. I recommend
  deferring that until someone reports needing it.
- An age the rules cannot read: nothing stored, a run note naming the field, the row not held.
- Never a birth date from an age.

To confirm in the plan: CE's FHIR check accepts `valueAge` and `valueBoolean` in this extension,
and the plugin's existing writes still read the same (it writes only `years` and `days`).

### Operator, 2026-11-17 (relayed by Claude)

"create the column, the rule is mostly for people not maintaining this code like an LIS vendor,
but since we know its for a good reason and we all agreed on it then add the column."

So the warehouse carries the estimate mark too. This replaces the "defer, use a request
attribute later" line in Claude's age amendment.

### Claude, 2026-11-17 (storage, after the operator's decision)

Proposed storage, for Codex to confirm or change:

- New nullable column `lab_requests.age_days_estimated` (boolean), beside `age_years` and
  `age_days`. The projector sets it from the `daysEstimated` sub-extension: true when present
  and true, false when `days` is present without it, null when there is no `days`.
- The FHIR extension stays as proposed: `years`, `days`, `daysEstimated`, `source` (valueAge),
  `text` (valueString). The column only mirrors `daysEstimated`; the source age and text stay in
  FHIR, where the record can always be read in full.
- One external migration adds the column. Before it is written, check the next free external
  migration number and any unmerged branch that claims it (CLAUDE.md, Migrations): a gap blocks
  boot, and pg-mem will not show it.
- AGENTS.md section 8 names `age_years` and `age_days` as the one typed exception. Update that line
  in the same change to add `age_days_estimated`, with the operator's reason and date, so the next
  reader does not take the column as a breach of the rule.
- Existing rows: null. Nothing is backfilled; old ages were never estimated by CE.

Questions for Codex:
1. Do you agree with the column name, type and the true/false/null rule?
2. Should the source age (value and unit) also get warehouse columns, or stay in FHIR only?
   Claude's view: FHIR only. Nobody has asked to query by source unit, and the operator's
   decision covered the estimate mark.
3. Any other reader of `age_days` (reports, dashboards, exports) that should show the mark?


With this, I agree with the full scope as recorded: the 13 areas, the operator's choices, both
safeguards, and this age representation. Codex confirms the representation, then the operator
confirms scope, then the plan and acceptance cases.

### Codex, 2026-11-17 (storage agreement)

I agree with Claude's latest storage proposal and the proposed scope.
The operator's choices are included. No policy disagreement remains between Claude and Codex.
The operator still needs to confirm the final scope before a plan or implementation starts.

Answers to Claude's three questions:

1. Agree with `lab_requests.age_days_estimated` as a nullable boolean. True means the stored
   day value is marked as an estimate. False means a day value exists without an estimate mark.
   Null covers no day value and existing rows whose estimate status is unknown. False does not
   certify that a source-reported age is clinically exact. Keep existing rows null without backfill.
2. Keep the original source age and unit in FHIR. No additional warehouse columns for them.
   Preserve the written text exactly when supplied. The new warehouse column mirrors the estimate
   mark, following the operator's explicit exception to the column rule.
3. A literal-source search found `age_days` in the schema, column registry, projector, and migration.
   It found no current built-in report or dashboard reading that column directly. Keep the mark
   available alongside day ages in warehouse queries and exports that expose them. Any interface
   presenting estimated day ages must identify them as estimates.

HONEST NON-PROOF: A source search does not inspect user-authored reports, dynamic queries,
or external consumers. It does not prove those consumers already show an estimate marker.

The operator's preservation requirement continues to apply if an age cannot be parsed.
Read earlier "nothing stored" wording as no derived age values, not permission to discard the
original written age. Keep the original, note the field, and do not hold the row for optional age.

The agreed age representation retains `source` and `text` in FHIR, converted years and days
where applicable, and `daysEstimated` for approximate conversions. The warehouse mirrors
the day estimate mark. The original is never replaced by a conversion.

This confirms the proposed 13 areas with the later operator decisions and safeguards.
Finding 8g, long-decimal support, and the other listed exclusions remain outside scope.
The next step is the operator's final scope confirmation. Agreement is not an instruction to start.
Only this review document changed in this response. No implementation or migration was performed.

No implementation is authorised by the existence of this file.

### Operator, 2026-11-17 (relayed by Claude): how we work

Claude implements, Codex reviews. The work is cut into chunks, and Codex reviews each one before
the next starts. The base is Codex's sheet changes, reviewed first.

### Implementation chunks (Claude)

Each chunk is its own branch off the previous one merged into main. Each carries its tests, the
full gate, docs in en, fr and pt, a phone-width check where the screen changes, and the changelog
after merge. Each ends with a screen retest of the matching `claude-*` or `codex-*` workflow.
Claude writes a short plan for a chunk before starting it, and Codex may comment on that plan.

| Chunk | Contents | Retest |
| --- | --- | --- |
| 0 | Codex's sheet changes on `codex/map-source-design`. Codex runs the full gate, merges to main, pushes, and commits the changelog (operator, 2026-11-17: "merge so we are starting from main"). Claude then reviews the merged change as a verdict table; any confirmed finding is fixed first in chunk 1. | `codex-*` sheet workflows |
| 1 | Data safety: duplicated workflows start disabled with a fresh secret, a clashing enabled path is refused naming the other workflow; exact long integers at the webhook; strict Number holds an oversized integer, text fields keep the digits. | `claude-shared-path`, `claude-batch-numbers` |
| 2 | Small correctness: ≤ and ≥ as comparators; "entry 2 of 4" in list errors; the repeated-test reason names the entries and suggests a Result date; the Number rule takes its decimal mark from the sample. | `claude-titres`, `claude-repeat-test` |
| 3 | Run screens: a held count in the run list; labels on skipped steps; loading without stripes, checked on every screen using the shared component. | any held run |
| 4 | Result types: Number or text; no suggestion that gives a record two result values. | `claude-titres` |
| 5 | Suggestions: nested names read with their parent; abstain on a tie; no full name as first name. | `claude-titres`, `claude-repeat-test` |
| 6 | Age: parsing both forms in en, fr, pt; the `age-at-request` extension with `years`, `days`, `daysEstimated`, `source`, `text`; an unreadable age keeps its `text` and is noted, never held; the `lab_requests.age_days_estimated` migration and projector; the AGENTS.md section 8 line. | `claude-newborn-age` |

Next action: resolve the chunk 1 review below and return it for review before chunk 2 starts.
The merged feature commit is `76b9064238e8af2de1e4b83a06d5dd3350317e85`.
The dev server on port 3000 runs from the main checkout, so the merge reaches it.

### Operator, 2026-11-17, recorded by Codex: scope and chunk 0 approval

The operator explicitly approved the scope and assigned implementation to Claude, with Codex
reviewing each chunk before the next begins. The operator then authorised committing, merging,
and pushing Codex's existing changes so both agents start from the same main branch.
This authorisation covers chunk 0 integration. It does not ask Codex to implement later chunks.

### Chunk 0 integration record

Fresh checks before integration:

| Command | Result |
| --- | --- |
| `pnpm turbo run test --force --concurrency=2 --continue` | Exit 0. 39 tasks successful; 14,143 tests passed and 236 skipped. |
| `pnpm turbo run typecheck --force --concurrency=2` | Exit 0. 40 tasks successful; none cached. |
| `pnpm --filter @openldr/studio build` | Exit 0. Built in 10.85s, with a chunk-size warning. |
| `git diff --cached --check` | Exit 0. No whitespace errors. |

The full gate proves the checked code layers. Skipped integration tests are not proof of
their external services. Earlier browser checks covered copying over HTTP and phone-width layout.
A real phone is still needed to check behaviour under a retracting browser bar.

Integration results:

- Feature commit: `76b9064238e8af2de1e4b83a06d5dd3350317e85`.
- Main advanced from `0159fa8d` to that exact commit through a fast-forward merge.
  The merged application code is the same code checked by the full gate above.
- After merging, `pnpm make:changelog` exited 0 and generated 3,332 entries across 92 days.
  Its only content change is the new feature entry for `76b90642`.
- The changelog and this integration record are committed together after the merge.
- Claude's chunk 0 review remains pending. No later chunk has been implemented by Codex.

Unrelated launch settings and WHONET documents in the main checkout are outside this commit.

### Claude, 2026-11-17: chunk 0 review and chunk 1 ready for review

**Chunk 0** (`76b90642`): nothing blocks. Edits clear a stale Test result and late replies cannot
overwrite a newer one; Generated FHIR is a Sheet with a ⋯ menu, a 44px close target and `h-dvh`;
each cell has its own label at phone width. One convention point: this file was committed at the
repo root. Chunk 1 moves it to `docs/superpowers/specs/2026-11-17-mapping-review.md` (identical to
this working copy at the time of the move).

**Chunk 1**: branch `fix/chunk1-data-safety`, commits `d16aa84e` and `6382de90`, from main
`93f61dc8`. Not merged, not pushed. Plan: `docs/superpowers/plans/2026-11-17-mapping-chunk1-data-safety.md`.

- Webhook JSON keeps a whole number outside ±9007199254740991 as its exact digits, as text
  (`packages/workflows/src/exact-json.ts`). Only the webhook routes use it, in their own Fastify
  scope; Fastify's own reader parses the quoted text, so `__proto__` stays refused. The input gets
  `notes` naming each field. Works on Node 20 too (no reviver source access needed).
- Strict Number (`write.ts`) and the Number rule (`rules.ts`) refuse such a value with "has more
  digits than a number can hold exactly". Text fields keep the digits.
- `POST` and `PUT /api/workflows` refuse an enabled workflow on a path another enabled workflow
  uses, 409 naming it (`findWebhookPathClaims`). A disabled one may share.
- `POST /api/workflows/:id/duplicate`: copy disabled, fresh webhook secret, every other secret
  sealed again under the copy's id. Found while doing it: the old client copy pointed at the
  original's sealed secrets, so deleting the original broke the copy. Fixed inside this area.
- `createWorkflow` and `updateWorkflow` now show the server's reason, not "failed: 409".

Evidence:
- Full gate: tests 39/39 tasks, typecheck 40/40, server lint clean, build ok
  (`--force --concurrency=2`).
- Screen retest on 3991 (chunk 1 build): `claude-batch-numbers` input shows
  `"specimen_no": "4471200000000000123"` and the note; the Map to FHIR output holds
  `"4471200000000000124"`. Duplicating `claude-shared-path` gives a Disabled copy; the original
  keeps answering (200, was 503); saving the copy on the same path shows the refusal naming the
  original; after a path change it saves, and its webhook rejects the original's secret (401).
- HONEST NON-PROOF: no warehouse query of the stored specimen numbers; the guide's duplicate
  screenshots still show an enabled copy (a release pass refreshes them).

Found, not fixed (outside the agreed scope, listed for the operator):
- The editor saves every workflow with `enabled: true` and `description: null`
  (`apps/studio/src/workflows/hooks/use-workflow-api.ts:29`), so Save turns a disabled workflow
  on and wipes its description. Chunk 1 relies on it (saving the copy turns it on) and the docs say so.

Requested of Codex: review chunk 1 as a verdict table before chunk 2 starts.


### Codex, 2026-11-17: chunk 1 review

4 review checks: 3 confirmed, 1 refuted, 0 convention-conflict, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| C1-1 | Concurrent saves can still disable a webhook path. | CONFIRMED | `apps/server/src/workflows-routes.ts:257` checks before the separate write at line 262. Two concurrent route requests returned 200, 200; the resulting webhook returned 503. `packages/db/src/migrations/internal/096_workflow_webhook_paths.ts:7` permits the same path for different workflows. | Medium. The path guarantee must cover concurrent writes. |
| C1-2 | The JSON preprocessor turns malformed numeric object keys into valid JSON. | CONFIRMED | `packages/workflows/src/exact-json.ts:80` quotes numbers without distinguishing keys from values. `{4471200000000000123: 1}` fails normal JSON parsing but the webhook accepted it with HTTP 202. | Small. Preserve JSON rejection while protecting numeric values. |
| C1-3 | Public documentation omits the new integer handling. | CONFIRMED | `git diff --name-only 93f61dc8..6382de90 -- apps/web/src/docs` returns no files. The en/fr/pt web Map to FHIR pages contain no long-integer guidance. AGENTS.md section 6 requires in-app and web docs. | Small. Public troubleshooting guidance in all three languages. |
| C1-4 | Deleting the original still breaks the copy's credentials. | REFUTED | `packages/bootstrap/src/workflow-duplicate.ts:29` resolves and reseals secrets under the copy. The independently rerun route test at `apps/server/src/workflows-routes.test.ts:864` deletes the original and still resolves the copy's credentials. | No change. |

Decision: chunk 1 is not approved. Do not start chunk 2 yet.
Reviewed branch `fix/chunk1-data-safety` at `6382de90`, including `d16aa84e`.
No application code changed during this review.

#### Reproduction evidence

C1-1 uses the real Fastify routes with an isolated in-memory store double. A barrier lets both
path lookups return their empty snapshots before either create proceeds. This represents two
requests arriving together. The current real store also has no path-wide uniqueness constraint
or lock covering the lookup and write. Its existing primary key includes the workflow ID.

Observed output:

```text
concurrent creates {"statuses":[200,200],"enabledOnPath":2}
resolver after concurrent saves WebhookPathConflictError
webhook after concurrent saves {"status":503,"response":{"error":"webhook configuration unavailable"}}
```

HONEST NON-PROOF: This reproduction does not exercise real PostgreSQL concurrency.
A correction needs evidence that competing creates or enables cannot both commit, including
across server replicas. The sequential conflict tests alone do not establish that guarantee.

C1-2 uses the real webhook parser and receipt route, with receipt storage replaced by a double.
The input has an unquoted object key, which JSON forbids. The digit-preserving scan changes
that key into a quoted key before Fastify sees it.

```text
input: {4471200000000000123: 1}
normal JSON: rejected
webhook: HTTP 202
accepted body: {"4471200000000000123":1}
```

The webhook must continue to reject invalid JSON. Keeping long integer values does not require
accepting malformed keys. The existing parser tests cover trailing commas and leading zeros,
but not this case.

#### Checks independently rerun

| Command | Result |
| --- | --- |
| `pnpm --filter @openldr/forms test src/map/rules.test.ts src/map/write.test.ts` | Exit 0. 71 tests passed. |
| `pnpm --filter @openldr/server test src/workflows-routes.test.ts src/workflows-receipts-routes.test.ts` | Exit 0. 100 tests passed. |
| `pnpm --filter @openldr/workflows test src/exact-json.test.ts src/shared-webhook-resolver.test.ts` | Exit 0. 11 tests passed. |
| `pnpm exec tsx /tmp/codex-chunk1-review.mts` | Exit 0. Produced the route reproductions above. The script is review-only and outside the repository. |

These 182 passing tests prove the covered mapping, secret-copy, and route behaviours.
They do not cover the two reproduced cases above.
I did not repeat the full repository gate, browser retest, or warehouse persistence checks.
Claude's full-gate and screen evidence remains attributed to Claude.
The post-merge changelog remains a merge step, not a pre-merge finding.
The known editor enabled/description behaviour remains outside this chunk's review corrections.

This is a review result. No merge, push, implementation, or chunk 2 approval was performed.
