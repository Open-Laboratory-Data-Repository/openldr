# Migration part 1, the copy: kickoff prompt

Paste the block below into a new session to start the build. Use it only after the
CLI-through-the-app work is merged into `main`.

Plan: `docs/superpowers/plans/2026-11-13-migration-part-1-copy.md`
Spec: `docs/superpowers/specs/2026-11-13-disa-and-v1-migration-design.md`

```text
Build part 1 of the migration work: the copy.

Plan: docs/superpowers/plans/2026-11-13-migration-part-1-copy.md
Spec: docs/superpowers/specs/2026-11-13-disa-and-v1-migration-design.md

You are the controller. You are the owner and long-term maintainer of this codebase,
and its design is up to you. Settle builder-level questions yourself and record each
ruling with its reason. Do not stop to ask me about them.

Run it with superpowers:subagent-driven-development. One implementer and one reviewer
per task, each a fresh subagent on Opus 5.5 at high effort. You do not write the code
yourself.

Before Task 1:
- Read the spec, the plan, AGENTS.md, CLAUDE.md, and these memory notes:
  sdd-build-lessons, worktree-reads-dev-env, owner-stance-and-opus-subagents,
  power-cut-push-often, cdr-toolchain-frozen, country-data-access.
- Confirm the CLI-through-the-app work is merged into main. Task 9 edits
  packages/cli/src/command-meta.ts, which that work adds. If it is not on main, stop
  and tell me.
- Create a worktree at .claude/worktrees/migration-copy on a new branch from
  origin/main.
- Scan every branch for internal migrations and pick the next free number. Use it
  wherever the plan says NNN.
- Confirm every file and line the plan cites. Lines drift.
- Search the plan for anything that starts a server or the CLI from the worktree,
  and add the env rule to those briefs.
- Keep your notes in .superpowers/sdd/2026-11-13-migration-part-1-copy/ in the
  worktree: constraints.md, implementer-rules.md, reviewer-rules.md, progress.md,
  and a brief and a rulings file per task. Rulings go in files, not long prompts.

Rules for the run:
- Safety on this machine. A dev stack is running and in use. Never stop or change
  it. Never point branch code at the databases openldr, openldr_target, openldr_docs,
  openldr_docs_target or keycloak. Anything started from the worktree gets
  OPENLDR_SKIP_ENV_FILE=true and its own database URLs. Ports 3990 to 3997, scratch
  databases named sa_scratch_*, temp folders, all removed afterwards.
- The container openldr-mssql on port 1433 holds my Mozambique v1 sample. You may
  read it through a connector with SELECT only, as a larger source for the real run.
  Never write to it, never stop it, never change it.
- Implementers stage files by name. No second agent runs pnpm while an implementer
  is changing a package manifest.
- Task 12, the real run, happens before the final review. Give it every item a
  review marked "proven by reading only".
- After you rule a fix in, ask the re-reviewer to attack the ruling itself.
- Before the fix wave, run one focused read on two things: no source row value
  reaches a log line, an audit row, an error message or a CLI line, and every
  statement sent to a source is checked to be a single SELECT.
- If validateSelectSql refuses the star select in Task 7, stop and tell me. Do not
  loosen the check.
- Commit after each task and push the work branch to origin each time, because of
  the power cuts. No Co-Authored-By line.

Do not build: top-up passes, the DISA plugin, or parts 2 to 4. The open questions in
section 11 of the spec block none of the 13 tasks.

Stop and ask me only for: a destructive action, a merge into main, a push to main,
or work that grows past the plan.

At the end: run the whole-branch review and one fix wave, merge main into the branch
and run the forced gate on the merged head, then list every ruling with its cost and
ask me whether to merge into local main. After a merge: pnpm install
--frozen-lockfile in the main checkout, check /health on port 3000, run
pnpm make:changelog and commit the json. Ask before pushing main.
```

## Two lines the operator may want to change

- Pushing the work branch after each task. It is there because of the power cuts. The CLI
  build was told not to push at all. Delete the line to get that behaviour again.
- Reading the Mozambique sample in the real run. It gives a source of 557,151 request rows
  in place of a tiny fixture. Delete the line if the build should never touch that
  container.

## If the build starts on the laptop

The memory notes the prompt names live on the Linux box, not in this repo. On the laptop
the session will not find them. The rules they hold that matter most are already in the
prompt and in the plan's "Global constraints". The Mozambique sample and the dev stack are
on the Linux box too, so the safety rules and the container line apply only there.
