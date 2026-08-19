# OpenLDR CE Claude Code notes

**The shared rules live in `AGENTS.md`. Read it first.** It is the source of truth for
communication style, RULE 0, audit handling, scope, UI conventions, and verification.

@AGENTS.md

Everything below is Claude-Code-specific and does not apply to other agents.

---

## Answer style

My baseline is ~19.5 words per sentence and ~62 compound terms per 1,000 words. The operator
writes at 14.7 and 42.7. That gap holds across 224 spec files. Hard tasks do not cause it,
and it is what makes my output unreadable to the person who has to approve it.

Write at the operator's register, not mine. Short sentences. Plain nouns. No coined names.

The `unslop` skill in `.claude/skills/unslop/` lists the 31 tells to strip. It applies to
every reply, spec, doc, and commit message. Rule 13 bans em dashes. Rule 18 bans emoji in
headings and bullets. Both bind this file and `AGENTS.md`.

---

## Memory

Index: `~/.claude/projects/D--Projects-Repositories-openldr-ce/memory/MEMORY.md`

Memory records **what was true when written**. It is not a spec and not a permission slip.
If a note names a file, flag, or function, verify it still exists before acting on it.

**Memory alone does not change behavior.** The dots-menu rule sat in memory the whole time
and still broke across 15 separate sessions. That is why the UI rules now live in
`AGENTS.md`, which loads every session. When a rule keeps breaking, promote it to
`AGENTS.md` or a hook. Do not write another memory file and expect a different result.

---

## Skills

- **Creative work** (new feature, component, behavior change) starts with
  `superpowers:brainstorming`, before planning.
- **Any bug or unexpected behavior** starts with `superpowers:systematic-debugging`, before
  you propose a fix.
- **Before claiming complete**, run `superpowers:verification-before-completion`.
- Multi-step work with a written plan uses `superpowers:writing-plans`, then
  `executing-plans`.
- **Anything you write** goes through `unslop` before you hand it over.

Subagents are not the default. The operator has asked for sequential work when a problem is
already slippery: *"no don't use subagents, go one by one so we don't miss anything."*
Ask before fanning out on anything already going badly.

---

## Test gate

- Full gate: `pnpm turbo run test`. **Never pipe turbo through `tail`.** It truncates the
  failure list and hides which package failed.
- A gate failure is usually a **timeout, not a regression.** Grep the output for
  `Test timed out` and re-run that package alone before blaming a change.
- `apps/server` is the only package with real lint. It enforces the return/await
  `reply.send` rule that stops gzip from clobbering the response.

---

## Migrations

Kysely enforces **strict numeric prefix order**. A gap blocks boot. Before adding a
migration, check for unmerged branches that may already claim the next number. pg-mem
cannot catch this and the failure only appears on a real boot.

---

## Merging

Work merges to **local `main`** first, then syncs to origin. Confirm the origin SHA after
pushing. Do not open a PR unless asked.
