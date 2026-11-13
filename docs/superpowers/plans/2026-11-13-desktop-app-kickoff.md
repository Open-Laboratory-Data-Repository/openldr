# Desktop app, design D: kickoff prompt

Paste the block below into a new session to build the whole of design D. Start the session
on the Linux box, in the main checkout. It needs that machine: the dev stack, the display,
and the AppArmor rules the Linux part depends on are all there.

The prompt is written for a run the operator follows from a phone, away from every
computer. So the session never waits for a step only the operator can do. It builds
everything else and leaves those steps as one list.

Use it only after these four files are on `main`:

- Spec: `docs/superpowers/specs/2026-11-13-desktop-app-design.md`
- Plan, part 1: `docs/superpowers/plans/2026-11-13-desktop-app-part-1-other-systems.md`
- Facts for part 2: `docs/superpowers/plans/2026-11-13-desktop-app-part-2-facts.md`
- This file

Plans for parts 2 and 3 do not exist yet. The session writes them.

```text
Build design D, the desktop app. All of it: parts 1, 2 and 3.

Spec: docs/superpowers/specs/2026-11-13-desktop-app-design.md (approved 2026-11-13)
Plan, part 1: docs/superpowers/plans/2026-11-13-desktop-app-part-1-other-systems.md
Facts for part 2: docs/superpowers/plans/2026-11-13-desktop-app-part-2-facts.md
Plans for parts 2 and 3 are not written. You write them.

You are the controller. You are the owner and long-term maintainer of this codebase, and
its design is up to you. Settle builder-level questions yourself and record each one as a
ruling in the ledger, with its reason and what it costs if wrong. Do not stop to ask me
about them.

Run it with superpowers:subagent-driven-development. One implementer and one reviewer per
task, each a fresh subagent on Opus at high effort. You do not write product code
yourself. At the end, one whole-branch review and one fix wave.

I AM AWAY. I am not at any computer while you run. I follow from my phone. Three things
follow from that.
- Never wait for me to run something. I cannot reach the Windows laptop, the Mac mini or
  a terminal on this machine, and I cannot type the administrator password. Build
  everything that needs none of that. Collect what does need it in one list (see "THE
  HANDS-ON LIST").
- Write to me for a phone. Lead with the answer. Short lines. No wide tables in a status
  message.
- Ask me every decision with the AskUserQuestion tool: 2 to 4 options I can tap, the
  one you recommend first. State the same question in plain text in your message too.
  The next-step box and session cards may not show on my phone, so never rely on them
  alone.
- Nobody is at the screen, and I cannot see it from the phone. A window you open still
  appears there: keep it short and close it. After a UI change, look at the picture
  yourself and send me the key ones with SendUserFile, with one line on what to look at.
- A browser pane approval card shows only on the Linux PC. If the pane waits on one, do
  not wait for me: test with curl and say the click is untested.
- A tool call that stops while I am away is not a refusal. Say so plainly.

PACE. Spend the tokens on building. Test what you need to prove a thing works, and no
more. Keep the reviews and the gate: they are how the work stays right. Leave polish,
extra variations of a check, and every follow-up for later, and list them. I will go
through details and follow-ups with you afterwards.

THE ORDER. This replaces the order in section 7 of the spec, which put the Windows and
macOS check first and made it a stop point. That check now waits for me, and nothing
else does.

1. Part 2: the launcher's changes, the app, the setup code hand-over, sample data from
   Studio, and the first run in Studio (spec 6.2 to 6.6, slices 2 to 6). Write its plan
   with superpowers:writing-plans, from the spec and the facts file. Have a fresh
   subagent read the plan as a builder who cannot ask anyone, and settle what it finds by
   ruling. Do not wait for me to approve the plan: I approved the spec. Then build it.
   All of part 2 can be built and proven on Linux.
2. When part 2's real run passes, tell me in one short message how to start the real app
   from the worktree, so I can tinker when I am back. Do not stop for an answer.
3. Part 1, the half that needs no hands. Use its plan with two changes. Wherever it says
   "the throwaway", pack the real app from part 2. And skip its Tasks 3, 4 and the sudo
   steps of Task 6: they go on the hands-on list. So: pack for the three systems, prove
   the Linux package from a folder outside the repo, and check the other two by listing
   what is inside them. The throwaway on the branch worktree-desktop-spike is reference
   only and is never merged.
4. Part 3: packages in the release step, the one-line installers, the landing page and
   docs (spec 6.7 to 6.9, slices 7 to 9). Write its plan without waiting for the Windows
   and macOS results. Where the spec says "slice 1 finds out", make the most careful
   assumption, record it as a ruling, and mark what rests on it "not proven, waits for
   the operator". Then build it.

THE HANDS-ON LIST. Keep one file in the worktree, docs/superpowers/specs/
2026-11-13-desktop-app-hands-on.md, and commit it. It holds everything only I can do, in
the order I should do it, each with the exact line to paste and what to tell you:
- the one line and the checklist for the Windows laptop;
- the one line and the checklist for the Mac mini;
- the sudo line that installs the AppArmor profile on this machine, the check to run
  after it, and the line that removes it;
- what to look at that no test can see: the tray icon on each system, and what each
  system does at shutdown.
The packages for the laptop and the Mac must still exist when I get to them. Keep them
in a folder in the worktree that git ignores, not under the temp folder, and put the one
command that serves them over the tailnet at the top of the list. Do not leave a server
running.

Before Task 1:
- Read the spec, plan part 1, the facts file, AGENTS.md, CLAUDE.md, and these memory
  notes: sdd-build-lessons, builder-shell-apparmor-profile, worktree-reads-dev-env,
  power-cut-push-often, remote-session-access-topology.
- Confirm the four files named above are on main. If not, stop and tell me.
- Create a worktree at .claude/worktrees/desktop-app on a new branch from origin/main.
  All three parts are built there.
- Confirm every file and line the facts file cites. Lines drift.
- If any task needs a database migration, scan every branch for the next free number.
  The migration build may claim one too.
- Keep your notes in .superpowers/sdd/2026-11-13-desktop-app/ in the worktree:
  constraints.md, implementer-rules.md, reviewer-rules.md, progress.md, and a brief and a
  rulings file per task. Rulings go in files, not in long prompts.

Rules for the run:
- Safety on this machine. A dev stack is running and in use: a server on port 3000 from
  the main checkout under nodemon, Postgres in the container openldr_ce-postgres-1 on
  port 5433, Keycloak on 8180, and Garage. Never stop, restart or change any of it. Never
  point branch code at the databases openldr, openldr_target, openldr_docs,
  openldr_docs_target or keycloak. Anything started from the worktree gets
  OPENLDR_SKIP_ENV_FILE=true. Use ports 3990 to 3997 and folders under the system temp
  folder, and stop and remove everything afterwards, except the packages kept for the
  hands-on list. Never print a password, key, token, setup code or secret. Do not edit
  my .env.
- Data folders. Never start the app or the launcher on a default data folder. Always
  pass a temp data folder. ~/.local/share/openldr may hold a real install of mine, and
  ~/.local/share/openldr-desktop-spike is what I tinker with. Leave both alone.
- Port 3000 belongs to the dev server. The real app takes 3000 when it is free, so every
  test and real run passes its own port.
- The sandbox. Your own shell runs under the Claude desktop app's AppArmor profile, which
  allows what Electron's sandbox needs. A sandbox check from that shell passes falsely.
  Run every such check with: aa-exec -p unconfined -- <command>. The last session got
  this wrong and told me the sandbox worked when it did not. Without the profile, which
  needs my password, the installed app cannot start with its sandbox on. So prove the
  Linux app with --no-sandbox for now, say so each time, and put the real proof on the
  hands-on list. The installed app must never ship with the sandbox off.
- Secrets on screen. Never take a picture of, or read, a page that shows a setup code or
  a key. A value you overwrite in a field comes back the next time the page redraws. Give
  the app a self-check mode that hides the field and reports lengths only.
- The other machines. Do not log in to my laptop or my Mac.
- Hooks. A hook refuses the first Bash command of a turn, the first write or edit of
  each file, and every rm -rf, until the facts it asks for are stated. The first try is
  always refused: state the facts and send the same call again. Inside a worktree a git
  command must be plain and alone: one per Bash call, no cd before it, no subshell, no
  command substitution. A heredoc that names git is refused, and so is a command that
  names the .github folder. Use the Write tool for files. git -C to the main checkout is
  refused from a worktree session; leave the worktree (keep it) to merge. A cd in a Bash
  call moves the session's folder, so go back. Tell every subagent all of this.
- Implementers stage files by name. No second agent runs pnpm while an implementer is
  changing a package manifest. A lockfile change stays inside the changed package.
- Electron 45 has no install script but pnpm still asks for a decision: put
  electron: true under allowBuilds in pnpm-workspace.yaml, then fetch the binary with
  pnpm --filter <package> exec install-electron. Pin Electron to 45.3.0.
- A real run comes before the final review, for each part. Give it every item a review
  marked "proven by reading only". Do the browser check of the Studio first-run pages
  yourself, at 375 x 812, with the built-in browser.
- Ask every reviewer to name the risks it checked, to say whether each new test fails
  without its fix, and to check claims of fact against this machine, not only against
  the diff. After you rule a fix in, ask the re-reviewer to attack the ruling itself.
- Before the fix wave, run one focused read on five things: no setup code, password or
  key reaches a log, a launcher event, a page of the app, the tray or the settings file;
  the app answers Studio only on this computer's own address; the sample data route
  refuses a caller without the capability and an install that holds lab data; the
  install scripts check the checksum before they unpack and use sudo for the AppArmor
  profile and nothing else; the window cannot be sent to another site.
- A check that holds something open must first show it is still open. A signal test
  must cover the moment before the handlers are installed. Both bit the last session.
- A quoted message in a doc is copied from the source file, never from a report.
- The gate: pnpm turbo run test --force --concurrency=2 --continue, and
  pnpm turbo run typecheck --force --concurrency=2, each redirected to a file with the
  exit code read after the redirect. Never pipe turbo through tail. pnpm depcruise must
  report 21. The scripts/init test whose name contains "predates 0.1.10" already fails
  and is outside the gate.
- Only Linux can be proven by you. Mark everything on Windows and macOS "not proven,
  waits for the operator". Never write "proven" for either.
- Commit after each task and push the work branch to origin each time, because of the
  power cuts. No Co-Authored-By line and no "Generated with" line.

Do not build: signing, a double-click installer, self-update, a setting that opens
OpenLDR to the network, Intel Macs, Linux or Windows on ARM, a build service, or a
fallback that runs the installed app with its sandbox off. The spec's non-goals and
anti-goals bind you.

Stop and ask me only for: a destructive action, a merge into main, a push to main, or
work that grows past the spec. A step only I can do is not a reason to stop. It goes on
the hands-on list.

At the end: run the whole-branch review and one fix wave, merge main into the branch as
its own step and run the forced gate on the merged head. Then give me, in this order:
what works on Linux and how you know; the hands-on list; what is not proven; every
ruling with what it costs if wrong; the verdict tables with their count splits. Then ask
whether to merge into local main, and say plainly that Windows and macOS have not been
tried. After a merge: pnpm install --frozen-lockfile in the main checkout, check /health
on port 3000, touch apps/server/src/index.ts if nodemon is waiting after a crash, run
pnpm make:changelog and commit the json. Ask before pushing main, and confirm the origin
SHA after a push.
```

## Lines the operator may want to change

- **The other machines.** The prompt forbids logging in to the laptop and the Mac. An SSH
  connection from the Linux box to the laptop already exists. With it, the session could
  run the Windows checks that need no window (start, health, stop, a leftover Postgres)
  while the operator is away. To allow that, replace the line with what it may do there.
- **Pushing the work branch after each task.** It is there because of the power cuts. Delete
  the line and the build pushes nothing until asked.
- **The order.** The spec put the Windows and macOS check first, as a stop point. The prompt
  moves it to the end, because the operator is away. If the operator is at the machines,
  put "THE HANDS-ON LIST" steps back where plan part 1 has them and let part 3 wait for
  the findings.

## What the session will find on this machine

- `main` at or after the commit that adds this file.
- The worktree `.claude/worktrees/desktop-spike`, branch `worktree-desktop-spike`. It holds
  the throwaway app. `pnpm dev` in `apps/desktop` there starts it. It is reference only.
- The worktree `.claude/worktrees/design-b-follow-ups`, fully merged. It can be removed.
- The memory notes the prompt names live on the Linux box, not in this repo. A session on
  another machine will not find them. The rules that matter most are in the prompt.

## One thing to check before leaving

A session that asks for permission before each command waits until someone answers. From a
phone that means approving each one. Choose the session's permission mode with that in mind.
