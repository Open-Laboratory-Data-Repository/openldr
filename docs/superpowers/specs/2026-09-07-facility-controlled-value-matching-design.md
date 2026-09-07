# Facility imports: match a controlled value the way a person reads it

Design, 2026-09-07. Closes findings S-7 and S-5 from the screenshot pass of the same date.

## The problem

An operator mapping the Zambia register was shown a pick-list row for `Diagnostic centre` and asked
which concept it meant. The value set's own answer is `Diagnostic Centre`. The two differ by one
letter's case.

> "should we really show things that match 100%?, its not like its going to change"

They do not match 100%, and that is the defect. The canonical check is an exact, case-sensitive set
lookup (`facility-controlled-fields.ts:139-147`), so `Diagnostic centre`, `General clinic` and
`Eye clinic` all fall through to `unmapped` and become manual work.

The same pass reported the seeded vocabulary mixing spellings: `Health Center` and
`Radiology Services Center` against `Diagnostic Centre` and `Mobile Radiology and Imaging Centre`
(`072_facility_level_status_valuesets.ts`). The operator's own national export writes
`Health Centre`. So a register using British spelling has to be hand-mapped onto an American one.

**Operator decisions, 2026-09-07.** A case-only match resolves to the concept's CODE. The spelling
variant is handled by making the MATCH tolerant, not by editing the seeded vocabulary.

## RULE 0 pass

Six premises, each checked before anything below was designed.

| Premise | Finding |
|---|---|
| The canonical check is case-sensitive | **CONFIRMED.** `canonical` is a `Set<string>` of codes and displays, tested with `canonical.has(raw)` (`facility-controlled-fields.ts:139-147`). |
| A case-only match could be ambiguous | **REFUTED, and this is what makes the change safe.** Measured over both seeded sets: under case folding the only collisions are a concept's own code against its own display (`active`/`Active`). Zero collisions BETWEEN concepts, in `LEVEL_CONCEPTS` (63) and `STATUS_CONCEPTS` (3) alike. Under case-plus-`centre` folding, still zero. |
| The column has a shape worth protecting | **REFUTED.** A canonical value passes through UNCHANGED (`facility-controlled-fields.ts:180-181`), so `level` already holds codes (from mapped values), displays (from exact-display matches and from the facility form, which flattens a picked answer to its display) and arbitrary raw strings (the live install's 2776 rows carry `Functional`). Three shapes already. There is no invariant to break, only one to establish. |
| Something depends on those display strings | **REFUTED.** Nothing outside `072_facility_level_status_valuesets.ts` names `Health Center` or `Diagnostic Centre`, and nothing outside that seed and this package's own tests names the codes. |
| The blast radius is wide | **REFUTED, usefully.** `resolveControlledFields` has one production caller chain: `importFacilities`, which both HTTP doors and the CLI import run, plus the CLI's `suggest-values`. Changing it changes the import and nothing else. |
| The picker cannot find the right concept anyway | **REFUTED.** The ranker normalises punctuation and case already and scores on character bigrams, and its own docblock names this exact pair: "`health centre` vs `health center` scores high" (`facility-mapping-suggest.ts:73-80`). Finding the concept was never the hard part. This design removes the need to look for it. |

## Scope

**In.**

- One narrow, named normalisation for controlled-field values.
- Resolution resolves to the concept's CODE, so every resolved value in the column is one shape.
- A fail-closed guard: a normalised key shared by two different concepts is discarded, never guessed.

**Out, deliberately.**

- **Editing the seeded vocabulary.** No migration. `diagnostic-centre` and `health-center` keep their
  codes and their displays. Operator decision, 2026-09-07: make the match tolerant instead.
- **Renaming codes.** A code is what `term_mappings.to_code` points at and what is written into the
  register. Renaming one needs a data migration over `facility_registry` and `term_mappings`, and
  buys consistency in a column operators mostly read through the picker anyway.
- **General fuzzy matching.** See "Why this is not a slippery slope".
- **Picker ordering** (S-6). Separate, and next.

## Design

### 1. The normalisation

```
normaliseControlledValue(s) = s.trim().toLowerCase().replace(/centre/g, 'center')
```

Two rules, and each is there because a real register needed it: case, because a national export
capitalises to its own house style, and `centre`, because the Zambia MFL export writes
`Health Centre` while the seeded concept reads `Health Center`.

### 2. Resolution, in four ordered steps

For each distinct raw value of a controlled field:

1. **The raw value IS a concept's code, exactly.** Leave it alone. It is already the canonical form,
   and rewriting it to itself would be noise.
2. **An active `term_mappings` entry exists.** Use it.
   ⛔ **Operator intent wins over any automatic fold.** A register that deliberately maps
   `Health Centre` onto something other than `health-center` keeps that decision. Putting this step
   ahead of the fold is the whole reason the order is stated here.
3. **Its normalised key hits exactly one concept.** Resolve to that concept's CODE. The raw string is
   preserved in `extras.__source`, exactly as a hand-made mapping already does
   (`applyControlledFields`).
4. **Otherwise unmapped.** Written through unchanged, as today. **This still never blocks and never
   blanks** (`facility-controlled-fields.ts:169-171`).

Step 3 subsumes the exact-display case, because a display normalises to itself lowercased. That is
why `Health Center` starts writing `health-center`.

### 3. The fail-closed guard

The key map is built per value set. **A normalised key claimed by two different concepts is
discarded from the map**, and values matching it fall through to step 4 and stay unmapped.

Zero keys collide today, in either set, under either rule. The guard exists so that a concept added
later degrades to "ask the operator" rather than to a wrong answer. It is the same instinct as the
ranker's `WEAK_MIN` floor of 0.62, which exists to offer nothing rather than a wrong guess.

### 4. Why this is not a slippery slope

The rule is a fixed, enumerated list of variants, not a similarity score. It lives in a function
whose docblock says: **a rule is added only when a real register has been measured needing it, and
only when adding it introduces no cross-concept collision in any seeded set.**

Ranked suggestion already exists for everything else, and deliberately refuses to guess below its
floor. Anything that wants tolerance beyond an enumerated variant belongs there, behind the
operator's own confirmation, not here in a path that writes without asking.

## What this changes in existing data

Nothing already written moves on its own; there is no migration and no backfill.

But **the next import touching a register rewrites its resolved values to codes.** A column holding
`Health Center` today holds `health-center` after. That is the intended end state, and it is stated
here so it is known before it happens rather than discovered after.

The facility FORM is unaffected and still writes displays (`splitFacilityAnswers` flattens a picked
answer to its display). So a hand-made facility and an imported one still differ in shape. Closing
that is a separate decision about the form, not about the import.

## Error handling

- **A value set missing on this install** stays `notValidated`, unchanged, and none of its values are
  classified at all.
- **A collision in the key map** is not an error and is not reported to the operator as one: the
  affected values simply appear in the worklist, which is where an ambiguous value belongs.
- **An unmapped value never blocks.** Unchanged and load-bearing.

## Testing

State which layer each proves, per `AGENTS.md` §7.

- **`normaliseControlledValue` unit tests.** The two rules, and that nothing else is folded. Pure
  arithmetic; proves the rule, not its use.
- **`resolveControlledFields` unit tests.** The four steps in order, including the one that matters
  most: an active `term_mappings` entry beats a fold that would have said something different. Plus
  the collision guard, driven by a fixture value set with two concepts that normalise alike.
- **A seed-collision test.** Assert that the REAL seeded `LEVEL_CONCEPTS` and `STATUS_CONCEPTS`
  produce no cross-concept collision under the normalisation. This is the test that fails when
  somebody adds a colliding concept, and it is the reason the guard can stay quiet.
- **Import-level test.** A CSV whose `level` reads `Health Centre` imports as `health-center` with
  `extras.__source.level === 'Health Centre'`. Proves the write, which the unit tests do not.
- **CLI `suggest-values`.** Values that now resolve stop appearing in its output.

**Known non-proof up front.** pg-mem is not Postgres, and none of this touches SQL ordering or
correlated subqueries, so pg-mem is adequate here for once. What it cannot show is a real register's
value distribution: the honest proof is running the Zambia export through and counting how many of
its `level` values stop needing a decision.

## Sequencing

S-6 (the 66-item picker is in seed order) is next and is independent. It shortens the work this
design leaves behind, rather than overlapping with it.
