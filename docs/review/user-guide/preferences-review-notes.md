5 checks: 4 confirmed gaps, 1 refuted gap.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| P1 | The default start-page description ignores layouts. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/user-preferences.md:37` says Dashboard is the default. `apps/studio/src/shell/UserPreferencesSync.tsx:102` tries the layout's start page too. | Correct the explanation. |
| P2 | The menu description assumes every user sees Settings. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/user-preferences.md:26` lists Settings without qualification. `apps/studio/src/shell/AppShell.tsx:319` checks `settings.view`. `AppShell.tsx:285` also conditionally adds Layout. | Describe the controls used by each task. |
| P3 | Sidebar preferences have no walkthrough. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/user-preferences.md:16` gives a table entry. Its task headings cover start page, theme and language only. Live capture verified collapse and expansion. | Add two illustrated steps. |
| P4 | The guide lacks a still screenshot for each click. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/user-preferences.md:24` uses a clip before four steps and one result picture. Language and theme use the same arrangement. | Capture each control and reuse the approved Dashboard framing. |
| P5 | Language and theme instructions no longer match the app. | REFUTED | Live testing found Language, Français and the header theme toggle in the documented locations. `apps/studio/src/shell/AppShell.tsx:248` builds the Language submenu. `apps/studio/src/shell/ThemeProvider.tsx:60` handles the `d` shortcut. | Keep the behavior and improve its explanation. |

## Proposed menu position

Move Your preferences out of Start here into Personal settings. It is optional account customization. It is not a prerequisite for configuring a laboratory.

The new preview demonstrates this order. Published navigation remains unchanged.

1. Start here.
2. Set up your lab: Terminology, Facilities, Test catalog, Forms, Workflows.
3. Daily work: Dashboards, Reports, Activity.
4. Build and manage.
5. Personal settings: Your preferences, Layouts.

This is a reading order, not a requirement to configure every feature. Terminology explains the codes used by facilities, tests and forms. Workflows then explains how incoming data reaches those structures. The existing ingestion workflow is already installed by `packages/bootstrap/src/seed.ts:266`. Readers should inspect it before deciding whether they need a new one.

Terminology is the next guide I recommend reviewing. Workflows should follow the relevant facility, test and form setup. An existing lab's everyday users can go straight to dashboards or reports.

## Scope and evidence

The initial review changed only preview files. The operator approved publication and a move to Personal settings on 2026-11-12. The approved guide is now authored in English, French and Portuguese. The earlier images and clips remain unchanged.

`preferences-evidence/capture-manifest.json` records the checks, original screenshots and restored preferences. The screenshots show the real local application. They do not use sample data to perform these tasks. Older bundled images remain unchanged.

The preview has 12 numbered actions and 15 equal screenshot frames. Each numbered action has its own screenshot. The enlarged view preserves the same crop, sharp target and blurred surroundings.

The test account has development authentication bypass enabled. The tests changed language to French, switched the theme, selected Reports as the start page, reopened Studio, and checked sidebar controls. Language, theme, start page and collapsed sidebar were restored afterward.

HONEST NON-PROOF: the phone check uses a 375 by 812 browser viewport. No physical phone was tested. Browser chrome can affect controls pinned to the bottom.

HONEST NON-PROOF: no second device was used to verify preference synchronization. The synchronization explanation follows `apps/studio/src/shell/UserPreferencesSync.tsx:39` and `apps/studio/src/shell/useSidebar.ts:29`.

HONEST NON-PROOF: no named layout exists in this test install. The conditional Layout explanation follows `apps/studio/src/shell/AppShell.tsx:285`. No layout was created solely to illustrate preferences.

Rebuild the preview with:

```sh
python3 docs/review/user-guide/build-preferences.py
```

## Preview verification

`python3 docs/review/user-guide/build-preferences.py` reports:

```text
Preferences: 15 equal screenshot frames, 12 steps, 14 original captures.
```

Browser inspection found no missing images. Every numbered step has a screenshot. All 15 desktop frames measured 498 by 311.25 pixels. All phone frames measured 305 by 190.625 pixels. The 375px preview had no horizontal overflow. The expanded view retained the same source image, crop and 1.25px background blur. The preview theme button switched between light and dark.

These checks verify the preview's layout and interactions. They do not change the physical-phone and second-device limits above. App tests were not rerun because published application files did not change.

## Publication checks

- `pnpm --filter @openldr/studio test src/docs`: 94 tests passed.
- `pnpm --filter @openldr/web test src/docs`: 29 tests passed.
- `pnpm --filter @openldr/studio typecheck`: exit 0.
- `pnpm --filter @openldr/studio build`: built in 12.64s. Existing dependency annotation and chunk-size warnings remain.

Browser checks found all 15 focused frames in each language. Personal settings, Préférences personnelles and Preferências pessoais each contained the translated guide. A phone source image retained its 375 by 812 coordinates in the enlarged view. A fresh 375px visit had 267 by 166.875 image frames and no horizontal page overflow. English was restored afterward. These browser checks do not prove physical-phone rendering or synchronization between devices.
