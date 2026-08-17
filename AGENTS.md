# OpenLDR CE — agent rules

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

Rationale: dense phrasing is how unnecessary features survive review. Plain language is
the detection mechanism, not a style preference.

---

## 2. RULE 0 — falsify before you build

Every claimed gap is a **hypothesis**, including one written by another AI, by a previous
session, or by you.

Before building anything to close a gap:

1. Name the single fact that would make the gap **not real**.
2. Go check that fact first.
3. Cite `file.ts:line` as proof it is real.

Real example: `upsertByNationalCode` was specced and deferred because a note said keyed
re-import was missing. The parser already set `id = sha256(nationalSystem|nationalCode)`,
so `onConflict('id')` was keyed re-import. The whole feature was unnecessary and the
refutation was one file away.

If you cannot cite a line, you have not confirmed the gap. Do not build.

---

## 3. Audit and review handoffs — verdict table first, code never first

An audit document is **evidence, not a work order.** Severity codes and finding IDs make
it look authoritative. It is an opinion from a reviewer who cannot see this repo's
conventions or history.

When handed an audit, review, punch list, or another agent's findings, the **first and
only** deliverable is a verdict table. No code, no branch, no plan until it is approved.

| ID | Finding (plain words, ≤15 words) | Verdict | Proof | Cost |
|----|----------------------------------|---------|-------|------|

Verdicts — exactly one per finding:

- **CONFIRMED** — reproduced. Proof column cites `file.ts:line` or a command + output.
- **REFUTED** — checked, not real. Proof cites what disproves it.
- **CONVENTION-CONFLICT** — contradicts an established rule here. Name the rule.
- **DEFER-YAGNI** — may be true, but no user-visible symptom exists today. Say what
  symptom would justify it later.

Rules:

- Refute cheaply before confirming expensively. Refutations are usually one file read.
- **Never propose all findings as work.** If every row is CONFIRMED, you have not checked.
- Report the count split before anything else: "20 findings: 6 confirmed, 9 refuted,
  1 convention-conflict, 4 deferred."
- Scope is decided by the operator from that table, never by the audit's length.

Precedent: a facilities audit's 20 P1 findings were decomposed into 5 sub-projects and
weeks of slices, with no falsification pass. One finding (P1-20, "primary actions should
be visible") directly contradicted this repo's own dots-menu rule. If one finding in
twenty is wrong on grounds the auditor could not know, the rest are not automatically right.

---

## 4. Scope control

- Build the asked thing. Nothing adjacent.
- Notice something else broken? **Add it to a list. Do not fix it.**
- If the work grows past the brief, **stop and report** rather than continuing.
- "While I was in there" is not a reason. Neither is "it was easy".
- Before adding any feature, answer: **which user action is broken today without it?**
  No answer means do not build it.

---

## 5. UI conventions — `apps/studio`

This is the app. `apps/web` is the public landing site and has its own smaller component
set. **Before writing or editing any page or sheet, open the named sibling and copy it.**

**Actions → `⋯` dropdown, always.** Page-header, sheet, and per-row actions all go in a
`MoreHorizontal` `DropdownMenu`. Never a standalone Create/New button. Never a
`SheetFooter` with Cancel/Save.
Refs: `pages/settings/Connectors.tsx` (header), `forms-builder/FieldEditorSheet.tsx`
(sheet), `pages/Users.tsx` (row).

**Form fields → label-left / input-right.**
`grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`. Not stacked labels.
Textareas use `items-start`. Ref: `Connectors.tsx`.

**Empty state → `StripedEmpty`** (`components/ui/striped-empty.tsx`). Diagonal hatch.
**Loading → `LoadingState`** (`components/ui/spinner.tsx`). Spinner only —
**stripes imply emptiness, never show them while loading.**
In a table, both go in a `colSpan` cell with `p-0`, row `hover:bg-transparent`, and the
same `min-h-[16rem]` as the data state so the layout does not jump.

**Rules read edge-to-edge.** Dividers, `TabsList` bottom borders, and table borders bleed
to the pane edges while text stays inset. Use `<Divider>` / `<Bleed>` from
`components/ui/bleed.tsx`. A bleeding element must be a **direct child of the padded
container** — an `overflow-auto` ancestor clips it.

**shadcn only.** Never a native `<select>`, `<button>`, `<input>`, or `<dialog>`. If a
primitive is missing from `components/ui/`, build it in the existing Radix + `cn` pattern.

**Pagination — every table, no exceptions.**
Every `<Table>` gets `TablePagination` (`components/ui/table-pagination.tsx`), including
short config lists like Roles and marketplace registries. Do not skip it because the list
looks small today. **This is a deliberate operator override of the YAGNI rule in §4** —
the operator has stated it, so build it and do not re-argue the case.
Only omit pagination when the operator says so for that specific table.

---

## 6. Definition of done — a feature is five surfaces, not one

A user-facing feature is **not done** when the studio UI works. Every one of these is part
of the same task, not follow-up work. If you cannot finish one, say which and why.

**1. UI** — `apps/studio`, following §5.

**2. CLI parity** — admin, settings, danger-zone, and maintenance features must also be
`openldr` CLI commands. Labs run headless; the CLI is the operator surface.
Put shared logic in `@openldr/bootstrap` so the Fastify route and the CLI call identical
code — never duplicate. Destructive commands refuse without `--force`. Audit as
`actorName: 'cli'`. Pattern: `packages/cli/src/*.ts`, registered in `index.ts`.

**3. Docs** — in-app docs and web docs, in **en, fr, and pt**. A missing i18n key renders
as literal braces, so a partial translation ships visibly broken.

**4. Mobile view** — `apps/studio` is used on phones over Tailscale.

**5. Landing changelog** — run `pnpm make:changelog` and commit
`apps/web/src/landing/changelog.json` in the same slice that lands the work.
It is **generated and committed**, not build output, and nothing regenerates it — the public
`/changelog` page shows whatever was last committed. It reads a rolling window of the last 400
commits, so waiting until release day silently drops the oldest entries off the tail. Only
`feat`/`fix`/`perf` are published, so a slice of `chore`/`docs`/`test` commits changes nothing
and the run is cheap either way. Run it after merging to `main`, not before — the generator
reads git history, so it cannot see commits that are not there yet.

The landing's **other** generated artefact, `pnpm gallery:screenshots`, is NOT part of this —
it is a heavy Playwright capture needing `PORT=3100`, and belongs to a release pass.
See the [[landing-site-generated-content]] memory note for its traps.

### Mobile testing — know what your tool cannot see

Use `resize_window` at 375×812 for layout, overflow, and tap targets. It genuinely catches
most of it. But be honest about the limit:

⛔ **Headless Chromium cannot see the `vh`-vs-`dvh` bug class.** It has no retractable URL
bar, so `100vh` and `100dvh` measure identically and **every bottom-edge check passes
either way**. This is the bug that cost the most time on the last mobile pass: `h-screen`
plus `overflow-hidden` put bottom-pinned UI under the browser chrome, unreachable on a real
phone. Fixed with `h-dvh` in `AppShell.tsx`.

So: use `h-dvh`, never `h-screen`, on anything full-height — and when a change touches
bottom-anchored UI, **say that only a real phone can confirm it.** Do not report it verified.

Three more traps from that pass, all still live:
- `Table`'s scroll wrapper needs `wrapperClassName="min-h-0 flex-1"`, the parent must be a
  flex column, and the fill must be gated on having rows — otherwise the loader splits the
  pane 50/50.
- An empty table's **header** forces intrinsic width and scrolls sideways. Render `<Table>`
  only when populated; let the empty state fill.
- Portalled `PopoverContent` inside a Sheet cannot scroll (`react-remove-scroll` only allows
  the Sheet's own subtree). Wrap instead of scrolling horizontally inside a dialog.
- Radix hides an inactive `TabsContent` with `hidden`, but a `flex` class out-ranks the
  zero-specificity `:where()` rule and the hidden panel still steals space. Guard with
  `data-[state=inactive]:hidden`.

---

## 7. Verification

- A green test proves only the layer it exercises. **Say which layer, and which it does not.**
- pg-mem is not Postgres. It has no correlated-subquery support and a stable scan order,
  so it can never demonstrate `ORDER BY` tie non-determinism. Any `ORDER BY` + `OFFSET`
  needs a unique tiebreaker; pg-mem will never tell you.
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
