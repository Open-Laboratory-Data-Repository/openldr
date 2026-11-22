# Brief for the session that builds lab slice 1a

Start the session in `/home/fredrick/Projects/Repositories/openldr_ce/.claude/worktrees/lab-module`
(branch `feat/lab-module`) and paste the text below as the first message.

---

Build OpenLDR CE lab module slice 1a by executing the plan
`docs/superpowers/plans/2026-11-22-lab-slice-1a.md` task by task, with the
`superpowers:subagent-driven-development` skill: a fresh implementer subagent per task, a fresh
reviewer after each (spec compliance and code quality), fix rounds when a review finds Critical or
Important issues, then one whole-branch review. Subagents run on Opus at medium effort.

Read first, in order: `AGENTS.md` and `CLAUDE.md` at the repo root, the approved design
`docs/superpowers/specs/2026-11-22-lab-module-design.md` (the authority where plan and design
differ), then the plan. Run Task 7 (capabilities and roles) before Tasks 5 and 6.

Done means:
- all 9 tasks reviewed clean, or with recorded rulings;
- the full gate green: `pnpm turbo run test --force --concurrency=2 --continue`,
  `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`, exit
  codes read from redirected files, never through a pipe or `tail`;
- Task 9's real Postgres proof on a new clean standalone run;
- screenshots of the Laboratory settings page and the test sheet at desktop and 375 wide, sent with
  SendUserFile;
- a report listing every ruling made, with what it costs if wrong;
- then ask whether to merge into local `main`. No merge, push or publish without a yes.

Safety:
- The worktree reads the dev `.env`. Run anything that opens a database with
  `OPENLDR_SKIP_ENV_FILE=true` from a scratch folder, on its own data folder and ports. Copy the
  approach of the scripts in
  `/tmp/claude-1000/-home-fredrick--claude-spares-spare-0EQSqc/d637bdd5-983b-416b-851a-0cfc5d14b2ef/scratchpad/standalone-proof3/`.
- Never use ports 3000, 5433, 3210, 3212 or 54320. Never connect to the dev databases.
- A proof install is running on `100.107.125.94:3212` (data folder `standalone-proof3`). Do not
  stop it or change its data. For Task 9 step 3, copy its data folder and run the copy on other
  ports.
- Check every unmerged branch before claiming migration 137.

Preferences: ask every decision with AskUserQuestion (2 to 4 options, your pick first) and also in
plain text, since the operator follows from a phone. Plain short sentences, no em dashes, no emoji
in headings or bullets (`.claude/skills/unslop/`). No `Co-Authored-By` trailer. Studio action
results are sonner toasts, never a status line in the page.
