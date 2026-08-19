# OpenLDR CE agent rules

Applies to every AI agent on this repo (Codex, Claude Code, any other).
Claude-specific setup lives in `CLAUDE.md`, which imports this file.

---

## 1. How to answer

- **Lead with the answer.** No preamble, no restating the question.
- **Short sentences.** Target 15 words. Long sentences hide unjustified work.
- **No coined names.** If you invent a term ("the importer tells the truth"), you have
  hidden the thing it does. Say what it does in plain words instead.
- **Define or delete jargon** on first use. If the operator would have to guess, rewrite it.
- **State what you did not do**, what you skipped, and what you are unsure of.
- Never say "done", "fixed", or "working" without the command and its output.
- **Run the `unslop` skill over anything you write.** It lists 31 AI tells. Two of them bind
  this file as well. No em dashes anywhere. No emoji in headings or bullets.

Dense phrasing is how unnecessary features survive review. Plain language is the detection
mechanism, not a style preference.

`unslop` applies to new writing only. The 495 files already in `docs/superpowers/specs/`
and `docs/superpowers/plans/` predate the rule and stay as they are. They are a record of
decisions we already made, and rewriting them changes no future output. Do not reformat
them, and do not read their em dashes as permission to use one. The operator decided this
on 2026-08-19.

---

## 2. Falsify before you build (RULE 0)

Every claimed gap is a **hypothesis**, including one written by another AI, by a previous
session, or by you.

Before building anything to close a gap:

1. Name the single fact that would make the gap **not real**.
2. Go check that fact first.
3. Cite `file.ts:line` as proof it is real.

A real case: a note said keyed re-import was missing, so someone specced
`upsertByNationalCode` and deferred it. The parser already set
`id = sha256(nationalSystem|nationalCode)`, so `onConflict('id')` was keyed re-import. The
whole feature was unnecessary and the refutation sat one file away.

If you cannot cite a line, you have not confirmed the gap. Do not build.

---

## 3. Audit and review handoffs

**Verdict table first. Code never first.**

An audit document is **evidence, not a work order.** Severity codes and finding IDs make
it look authoritative. It is an opinion from a reviewer who cannot see this repo's
conventions or history.

When handed an audit, review, punch list, or another agent's findings, your first and only
deliverable is a verdict table. No code, no branch, no plan until the operator approves it.

| ID | Finding (plain words, 15 words or fewer) | Verdict | Proof | Cost |
|----|------------------------------------------|---------|-------|------|

Give every finding exactly one verdict.

- **CONFIRMED.** You reproduced it. The proof column cites `file.ts:line`, or a command and
  its output.
- **REFUTED.** You checked it and it is not real. The proof cites what disproves it.
- **CONVENTION-CONFLICT.** It contradicts an established rule here. Name the rule.
- **DEFER-YAGNI.** It may be true, but no user-visible symptom exists today. Say what
  symptom would justify it later.

Rules:

- Refute cheaply before confirming expensively. A refutation is usually one file read.
- **Never propose all findings as work.** If every row is CONFIRMED, you have not checked.
- Report the count split before anything else: "20 findings: 6 confirmed, 9 refuted,
  1 convention-conflict, 4 deferred."
- The operator decides scope from that table. The audit's length never decides it.

A precedent: a facilities audit raised 20 P1 findings, and we turned them into 5
sub-projects and weeks of slices with no falsification pass. One finding (P1-20, "primary
actions should be visible") contradicted this repo's own dots-menu rule. If one finding in
twenty is wrong on grounds the auditor could not know, the rest are not right just because
nobody checked them.

---

## 4. Scope control

- Build the asked thing. Nothing adjacent.
- Notice something else broken? **Add it to a list. Do not fix it.**
- If the work grows past the brief, **stop and report** rather than continuing.
- "While I was in there" is not a reason. Neither is "it was easy".
- Before adding any feature, answer this. **Which user action is broken today without it?**
  No answer means do not build it.

---

## 5. UI conventions for `apps/studio`

This is the app. `apps/web` is the public landing site and has its own smaller component
set. **Before writing or editing any page or sheet, open the named sibling and copy it.**

**Actions go in a `⋯` dropdown, always.** Page-header, sheet, and per-row actions all go in
a `MoreHorizontal` `DropdownMenu`. Never a standalone Create/New button. Never a
`SheetFooter` with Cancel/Save.
Refs: `pages/settings/Connectors.tsx` (header), `forms-builder/FieldEditorSheet.tsx`
(sheet), `pages/Users.tsx` (row).

**Form fields put the label left and the input right.**
`grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`. Not stacked labels.
Textareas use `items-start`. Ref: `Connectors.tsx`.

**Empty state uses `StripedEmpty`** (`components/ui/striped-empty.tsx`). Diagonal hatch.
**Loading uses `LoadingState`** (`components/ui/spinner.tsx`). Spinner only.
**Stripes imply emptiness, so never show them while loading.**
In a table, both go in a `colSpan` cell with `p-0`, row `hover:bg-transparent`, and the
same `min-h-[16rem]` as the data state so the layout does not jump.

**Rules read edge-to-edge.** Dividers, `TabsList` bottom borders, and table borders bleed
to the pane edges while text stays inset. Use `<Divider>` and `<Bleed>` from
`components/ui/bleed.tsx`. A bleeding element must be a **direct child of the padded
container**. An `overflow-auto` ancestor clips it.

**shadcn only.** Never a native `<select>`, `<button>`, `<input>`, or `<dialog>`. If a
component is missing from `components/ui/`, build it in the existing Radix and `cn` pattern.

**Pagination on every table, no exceptions.**
Every `<Table>` gets `TablePagination` (`components/ui/table-pagination.tsx`), including
short config lists like Roles and marketplace registries. Do not skip it because the list
looks small today. **This is a deliberate operator override of the YAGNI rule in §4.**
The operator has stated it, so build it and do not re-argue the case.
Only omit pagination when the operator says so for that specific table.

---

## 6. Definition of done

A feature lands in five places, not one.

A user-facing feature is **not done** when the studio UI works. Every one of these is part
of the same task, not follow-up work. If you cannot finish one, say which and why.

**1. UI.** `apps/studio`, following §5.

**2. CLI parity.** Admin, settings, danger-zone, and maintenance features must also be
`openldr` CLI commands. Labs run headless, so operators work from the CLI.
Put shared logic in `@openldr/bootstrap` so the Fastify route and the CLI call identical
code. Never duplicate. Destructive commands refuse without `--force`. Audit as
`actorName: 'cli'`. Pattern: `packages/cli/src/*.ts`, registered in `index.ts`.

**3. Docs.** In-app docs and web docs, in **en, fr, and pt**. A missing i18n key renders
as literal braces, so a partial translation ships broken and the user sees it.

**4. Mobile view.** People use `apps/studio` on phones over Tailscale.

**5. Landing changelog.** Run `pnpm make:changelog` and commit
`apps/web/src/landing/changelog.json` in the same slice that lands the work.
You generate that file and commit it. It is not build output, and nothing regenerates it.
The public `/changelog` page shows whatever was last committed. It reads a rolling window of
the last 400 commits, so waiting until release day drops the oldest entries off the tail and
nobody sees it happen. The generator publishes only `feat`, `fix`, and `perf`, so a slice of
`chore`, `docs`, or `test` commits changes nothing and the run is cheap either way. Run it
after merging to `main`, not before. The generator reads git history, so it cannot see
commits that are not there yet.

The landing's **other** generated file, `pnpm gallery:screenshots`, is not part of this.
It is a heavy Playwright capture needing `PORT=3100`, and belongs to a release pass.
See the [[landing-site-generated-content]] memory note for its traps.

### Mobile testing

Know what your tool cannot see.

Use `resize_window` at 375x812 for layout, overflow, and tap targets. It catches most of it.
Be honest about the limit.

**Headless Chromium cannot see the `vh`-vs-`dvh` bug class.** It has no retractable URL
bar, so `100vh` and `100dvh` measure the same and **every bottom-edge check passes
either way**. This bug cost the most time on the last mobile pass. `h-screen` plus
`overflow-hidden` put bottom-pinned UI under the browser chrome, out of reach on a real
phone. `h-dvh` in `AppShell.tsx` fixed it.

So use `h-dvh`, never `h-screen`, on anything full-height. When a change touches
bottom-anchored UI, **say that only a real phone can confirm it.** Do not report it verified.

Four more traps from that pass, all still live:
- `Table`'s scroll wrapper needs `wrapperClassName="min-h-0 flex-1"`, the parent must be a
  flex column, and you must gate the fill on having rows. Otherwise the loader splits the
  pane 50/50.
- An empty table's **header** forces intrinsic width and scrolls sideways. Render `<Table>`
  only when populated, and let the empty state fill.
- Portalled `PopoverContent` inside a Sheet cannot scroll. `react-remove-scroll` only allows
  the Sheet's own subtree. Wrap instead of scrolling sideways inside a dialog.
- Radix hides an inactive `TabsContent` with `hidden`, but a `flex` class out-ranks the
  zero-specificity `:where()` rule and the hidden panel still steals space. Guard with
  `data-[state=inactive]:hidden`.

---

## 7. Verification

- A green test proves only the layer it exercises. **Say which layer, and which it does not.**
- pg-mem is not Postgres. It has no correlated-subquery support and a stable scan order,
  so it can never show `ORDER BY` tie non-determinism. Any `ORDER BY` plus `OFFSET`
  needs a unique tiebreaker, and pg-mem will never tell you.
- `typecheck` green does not pin a route's wire shape. Route tests are the only thing that does.
- If you could not prove it, write **"HONEST NON-PROOF"** and say what would prove it.

---

## 8. Never hardcode clinical vocabulary

Codes, organisms, statuses, and value sets come from the terminology service or config.
Never inline them into source or SQL.

---

## 9. Git

- Never add `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailers.
  The operator is the sole contributor.
- Commit or push only when asked.
