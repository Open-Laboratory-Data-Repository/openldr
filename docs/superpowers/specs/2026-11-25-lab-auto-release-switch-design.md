# Lab-wide auto-release switch

Date: 2026-11-25. Small change, lab plugin only (batch 3, item A5). Approved by the operator on
2026-11-25.

## Why

A test whose CE catalog entry says `requiresVerification: false` is released at submit when no value
is critical (`src/results.rs:934`, release design 2026-11-24). A lab that wants every result
reviewed, for example while it is being accredited, has to change every test in CE's catalog. That
catalog is shared by all labs. The 2026-11-24 design left this switch out ("Not in this slice").

## How Corlix does it

Corlix seeds `auto_release_enabled = 'true'` (`apps/desktop/src/main/migrations/index.ts:1258`) and
shows it as a Yes/No select on its General settings page (`SettingsGeneralPage.tsx:518`). Nothing in
its main process reads it, so the switch does nothing there. Only the idea and the default are
ported.

## Approaches

- Chosen: one lab setting in the plugin, beside "Allow self-authorise". Lab-wide, no CE change.
- Not chosen: change each test's catalog flag in CE. It is shared by every lab and is the wrong
  place for one lab's choice.
- Not chosen: a switch per section or per test in the plugin. No one has asked for it.

## Design

- Setting `allowAutoRelease`, boolean, default `true`, so a lab sees no change until it turns it
  off. Read and saved by `lab_settings_get` and `lab_settings_set`, audited like
  `allowSelfAuthorise`. A caller with a facility limit is refused, as today.
- When it is `false`, a submitted result always goes to `pending_review`, whatever the catalog
  says. The result view's `requiresVerification` is then `true`, so the Enter results sheet does
  not show the "released without review" line.
- A result CE already holds as an auto-release (its send row says `release: auto`) still finishes
  as one. Turning the switch off cannot leave a half-sent result stuck.
- Settings tab: a switch "Allow auto-release" under "Allow self-authorise", saved at once with a
  toast, as that switch is. Words in en, fr and pt.
- CLI: `openldr plugin call lab lab_settings_set --input '{"allowAutoRelease":false}'`.
- Guide (en, fr, pt): the task "Results that skip review" says how to turn it off.

## Proof

- `cargo test`: the default is on; off sends a no-review test to review; the view's
  `requiresVerification` follows the switch; a held auto-release still finishes; a limited caller
  is refused.
- UI test: the switch saves and shows its state.
- Live check on the dev stack: with the switch off, a no-review test waits on Review; turned back
  on, it auto-releases. The check puts the setting back.

## Left to the builder

- The fr and pt words.
