The later [pinned-contents repair](PINNED-CONTENTS-VALIDATION.md) replaces this layout.
The panel now remains visible in short windows and follows the active task.
This file preserves the earlier review and its evidence.

# Shared documentation scrolling

The operator approved removing the contents menu's independent scrollbar and correcting three formatting failures.
The changes use the existing review worktree on `codex/docs-shared-scroll`.

The earlier contents list had a height cap and `overflow-y-auto` at `apps/studio/src/pages/Docs.tsx:116-120`.
Its active-task effect also changed the inner list's scroll position at lines 107-108.
The browser regression found one independent scroll area before the repair.
The component regression returned scrollTop 80 when it expected zero.

The right-hand contents menu now shares the article's scroll area.
When the full menu fits, it stays beside the article as the reader scrolls.
When it is taller than the available space, it scrolls with the article.
A resize observer checks both menu height and available reading-pane height.
Active task highlighting and the task-only mobile menu remain.
The documentation chapter sidebar and mobile menu keep their existing behavior.

The three environment documents already named both variables.
The test requires each variable name inside backticks at `packages/config/src/env-docs.test.ts:47`.
The English, French and Portuguese pages now format both names as code.
No variable, default or runtime setting changed. The web pages already passed this check.

## Verification

```sh
pnpm --filter @openldr/studio test src/pages/Docs.test.tsx src/docs
pnpm --filter @openldr/config test src/env-docs.test.ts
pnpm --filter @openldr/studio typecheck
pnpm --filter @openldr/studio build
node docs/review/user-guide/shared-scroll-evidence/check-docs-scroll.cjs
```

The Studio test command passed 110 tests across 14 files.
The environment command changed from three failed and five passed to eight passed.
Typecheck returned zero. The production build returned zero in 10.77 seconds.
Existing dependency annotation and bundle-size warnings remain.
These checks cover documentation rendering and formatting, not the full repository.

The [browser proof](shared-scroll-evidence/browser-proof.json) records four desktop resize checks and a phone layout check.
Desktop heights were 1100, 500, 350 and 1100 pixels, at width 1600.
Every size had zero independent contents scroll areas.
Wheel events over the menu moved the article scrollbar.
At heights 500 and 350, the last task required article scrolling of 305 and 380 pixels.
The inner menu scroll position stayed zero.
A browser-only shortened article also overflowed because of its taller contents menu.
Its last task remained reachable through the article scrollbar.
The phone check at 375 by 812 retained 17 task choices without horizontal page overflow.

[The short-window screenshot](shared-scroll-evidence/short-window-menu.png) shows the contents menu before scrolling.
All evidence screenshots use native device scale 4.
No application data or preferences were changed. The shortened article existed only in the test browser DOM.

HONEST NON-PROOF: headless layout cannot test retractable phone browser chrome.
Physical phone testing was not performed.

Repair commit `334ce996` was fast-forwarded to main.
The merged checks passed 15 Docs component tests and eight environment-doc tests.
`pnpm make:changelog` then generated 3085 entries after the merge.
