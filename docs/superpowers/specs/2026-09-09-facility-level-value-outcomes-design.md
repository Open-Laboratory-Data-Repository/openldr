# Three outcomes for a controlled value, not one

Date: 2026-09-09
Status: approved, not yet planned

## The problem

Status maps one word to one code. Level does not.

The operator ran the Zambia MFL export and hit three different situations in one column:

- `Health Centre` belongs to a concept the list already has. Map it. This works today.
- `First-aid stations` is a real facility type this install has never heard of. It should join the
  list. There is no way to do that from here.
- `Others` is not a facility type at all. It should be left alone and never asked about again.
  There is no way to say that either.

Today the pick list offers `Not mapped` plus the 63 seeded concepts. `Not mapped` means "no decision
yet", so it can never mean "I decided". A row holding one such value stays red for the life of the
sheet, and every later import asks the same question again.

## What already exists, and must not be rebuilt

RULE 0 first. Four things this could have built are already here.

**Ignore already has a name.** `MapType` includes `UNMAPPED-FROM`
(`packages/db/src/terminology-admin-store.ts:44`). Nothing writes it yet.

**An added concept needs no mapping row.** `resolveControlledFields` indexes every concept by its
code AND its display, both normalised, and folds raw values onto that index
(`packages/bootstrap/src/facility-controlled-fields.ts:181-193`). A concept whose display is
`First-aid stations` therefore resolves the raw value with nothing else written.

**An ignored value drops off Review by itself.** Step 2 of the resolver puts any value with an
active mapping into `mapped`, and Review's list is built from `unmapped`. Nothing in Review changes.

**The row turns green by itself.** `unresolvedCount` subtracts values this sheet has written, so both
new outcomes clear the row through machinery that shipped on 2026-09-09 in `dbedbb4c`.

## Decisions taken

Six, by the operator, before this was written.

1. **An added type is scoped to its register.** Zambia's vocabulary is not Tanzania's. The shared
   list stays as seeded.
2. **Ignore changes no data.** An unmapped value is already written into the field verbatim and
   never blanked (`facility-controlled-fields.ts:227`), so `Others` already lands in `level` as
   `Others`. Ignore records the decision and nothing else.
3. **Adding is deliberate, not one click.** It opens a confirm showing what will be created.
4. **Adding needs `facilities.manage` AND `terminology.manage`.** The button writes to the
   vocabulary, so it is gated like a vocabulary write.
5. **Both pick lists get a section for outcomes that are not "map to a code"**, separated from the
   real choices, and anything of that kind added later joins that section.
6. **Ignore and add are `level` only.** `status` and `country` keep today's pick list. See the scope
   section for why, and for the symptom that would reopen it.

## The data model

### Ignore writes a mapping to itself

`mapType: 'UNMAPPED-FROM'`, `toSystem` the register's OWN observed system for the field
(`observedFieldSystem('level', nationalSystem)`), `toCode` the raw value verbatim. Source and target
are the same coordinates, which is the point: the value stands for itself inside this register.

The observed system, not the shared canonical one. `saveExclusive` auto-drafts a target concept it
cannot find (`terminology-admin-store.ts:876`). A raw value like `Others` is never a concept in the
shared `urn:openldr:cs:facility-type`, so naming that system would insert one DRAFT concept with a
null display per ignored value, into the vocabulary every register reads. The writer already files
the raw value in the register's own observed system a few lines earlier, so pointing there finds an
existing concept and drafts nothing.

An earlier draft of this spec chose the shared system and gave the reason that a register-scoped
target "would imply a concept that does not exist". That reason was wrong. This writer creates it.

`to_system` and `to_code` are both `NOT NULL` (`013_term_mappings.ts:10-11`), so the row needs
values. A sentinel such as `__unmapped__` is the wrong answer: `resolveControlledFields` reads
`active.toCode` straight into the field (`facility-controlled-fields.ts:212`), so any reader that
skipped the `mapType` check would write the sentinel into `level`. Pointing the row at the raw value
fails safe instead. A reader that checks `mapType` knows the operator decided; a reader that does not
writes the raw value, which is what already happens to an unmapped value.

It also puts the decision ahead of the automatic fold, which is the rule that file already states:
the operator's own decision wins. Ignore `Health Centre` and it stays `Health Centre` rather than
folding to `health-center`.

### Add writes one concept and nothing else

Create the concept in the register's own coding system with the confirmed display. No mapping row.
The display fold resolves the raw value already, and a second mechanism answering the same question
is how the two of them drift apart.

### One exclusivity change is needed

`saveExclusive` scopes by `(toSystem, mapType)` (`terminology-admin-store.ts:168-194`), so an ignore
row and a real mapping for one raw value would both stay active and
`listOutgoing(...).find((m) => m.isActive)` would take whichever came back first. Changing an ignore
to a mapping, or the reverse, must deactivate every active row for that `(fromSystem, fromCode)`
regardless of `mapType`.

## The register-scoped list

**The shared value set is never touched.** `urn:openldr:valueset:facility-type` stays exactly as
migration 072 seeded it, enumerating its 63 concepts explicitly.

**A register that has added something gets `urn:openldr:valueset:facility-type:<slug>`,** created
lazily on the first add. `<slug>` is the register uri put through the SAME derivation
`observedFieldSystem` already uses (`facility-controlled-fields.ts:60-68`): non-alphanumeric runs to
underscores, trimmed, lowercased, so `urn:zmb:mfl` becomes `urn_zmb_mfl`. Reused rather than
reimplemented, so the two can never disagree about what one register is called. A
register nobody has added to behaves exactly as it does today, and no install grows empty value sets.

**Its compose is two include clauses, not one.** Clause one imports the shared set by url. Clause two
names the register's own coding system with no `concept` and no `filter`, which expands to every
concept in it (`packages/db/src/value-set-expander.ts:62`).

⛔ Two clauses, because within a single clause the sets INTERSECT and only separate clauses union
(`value-set-expander.ts:69-73`). One clause naming both the imported set and the register's system
expands to their intersection, which is empty.

The bare system include is why the added concepts need their own system: adding is then one insert
and the compose never changes again. Putting them in the shared coding system instead would mean a
read-modify-write of that JSON on every add, and would share the vocabulary across registers, which
is the thing decision 1 rejects.

**The system is `urn:openldr:cs:facility-type:local:<slug>`, and `local` is load-bearing.** Raw
source values already live in `urn:openldr:cs:facility-level:<slug>`. A canonical system named
`urn:openldr:cs:facility-type:<slug>` would sit one word from it while holding the opposite side of
every mapping.

**Which list is used becomes a lookup.** `CONTROLLED_VALUE_SETS[field]` is a hardcoded url read by
the resolver, the mapping writer and the value suggester. It becomes
`valueSetForField(field, nationalSystem)`: the register's set when one exists, the shared set
otherwise.

## The UI

### The pick list gains a section

For a row whose target is `level`: `Not mapped`, `Ignore this value`, and
`Add "<value>" as a new type…`, then a separator, then the concepts. For `status` and `country`:
`Not mapped`, then a separator, then the concepts, which is decision 6. All three answer the question the operator actually faces: this value is not in the list,
so what now. Burying the add below 63 concepts hides it on the one path that needs it, and on a phone
that is a long scroll.

The column-map dropdown gets the same treatment: `Keep as extra data`, separator, then the contract
fields.

### The confirm dialog

Follows `RegisterSourceDialog`, the sibling that already opens from this sheet. Shows the display
prefilled with the raw value and editable, the code derived from it live and read only, and the
register it will be added to, named. One action.

The code is the display lowercased, every run of non-alphanumeric characters replaced with a single
hyphen, and leading and trailing hyphens trimmed: `First-aid stations` becomes `first-aid-stations`.
If that code is already taken in the register's own system, a numeric suffix is appended
(`first-aid-stations-2`). The code is never editable. It is an identifier the operator has no reason
to choose, and a hand-typed one is a way to collide on purpose.

**A colliding display is refused, not warned.** If the new display normalises to the same key as a
concept already in the expansion, adding it poisons that key and BOTH values silently degrade to
"ask" (`facility-controlled-fields.ts:192`). The dialog names what it collides with and offers to map
to that concept instead. `Centre` and `Center` already fold together, so `Health Centre` against the
seeded `Health Center` is the ordinary case, not an exotic one.

### Without `terminology.manage`

The add option is disabled and says why. Map and ignore still work, so the import is never blocked
outright.

## CLI parity

AGENTS.md section 6 item 2. Both outcomes reach the `openldr` CLI by extending what exists rather
than adding commands:

- An entry in the value-mapping apply file carries `ignore: true` in place of a target.
- `--add-type` writes a concept into the register's system.

Shared logic goes in `@openldr/bootstrap` so the route and the CLI call identical code.

## No migration

`UNMAPPED-FROM` is already in the `MapType` union, the value set and concept are created through the
existing admin store, and no column changes. The migration-ordering trap does not apply.

## Explicitly not in scope

**Removing an added concept.** The Terminology page already deletes concepts. A second door here
would be the dots-menu argument again. The docs say where to go.

**Renaming an added concept.** Same reason.

**The other two controlled fields.** `status` and `country` share the pick-list component with
`level`, and neither gets `Ignore this value` or `Add as a new type`. Their vocabularies are small
and closed: the Zambia export's four status words all map cleanly, and `country` is a fixed value
rather than a column. Offering an outcome nobody needs on two of the three fields is three times the
surface for one field's problem.

⛔ THIS IS A GATE ON THE FIELD, NOT AN ACCIDENT OF WIRING. `ValueMapRow` renders every controlled
field's values, so the option has to be withheld deliberately, keyed on the row's target being
`level`. A later reader who removes the check to "clean it up" has widened the feature.

The symptom that would justify widening it: a register whose `status` column carries a word that is
genuinely not a status, so the row cannot go green and every import re-asks. Nothing in the Zambia
export does that today.

## Verification, and its limits

Route tests and studio tests, written first.

`pg-mem` can exercise the expander, but the register value set's two-clause union wants one check
against real Postgres before this is called done.

The poisoned-key refusal needs its own test. It is the one failure in this design that is silent:
nothing errors, two values just stop resolving.

The confirm dialog at 375px is checkable with `resize_window`, but headless Chromium cannot see the
`vh`-versus-`dvh` class of bug, so anything bottom-anchored in it says only a real phone can confirm
it.

## Slices

Two. Each ships on its own and leaves the wizard working.

**Slice A: ignore.** The `UNMAPPED-FROM` write, the exclusivity fix, the resolver reading it, the
pick-list section and separator in both dropdowns, and the CLI's `ignore: true`. Answers "stop asking
me about Others", needs no new value set, and is the smaller half.

**Slice B: add.** The register-scoped value set and coding system, `valueSetForField`, the confirm
dialog with its collision refusal, the capability gate, and the CLI's `--add-type`.
