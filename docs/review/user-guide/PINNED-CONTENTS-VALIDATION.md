# Pinned documentation contents

The operator approved keeping the panel visible and following the active task without a separate scrollbar.
This replaces the short-window behavior from `16d08d65`.
That version disabled pinned positioning when the list was too tall at `apps/studio/src/pages/Docs.tsx:118`.
The panel then moved above the reading pane as the article scrolled.
The full-list toolbar button was also hidden on desktop at line 381.

The right panel now stays pinned whenever the window is wide enough to show it.
Its title stays visible. The list automatically reveals the active task and nearby headings.
The list has no scrollbar and does not consume wheel scrolling.
Wheel input over the panel moves the article instead.
Keyboard focus also reveals a task before it is activated.
The existing On this page toolbar button exposes every task at all window widths.
The narrow layout continues to use that menu.

Heading tracking responds to resizing and article layout changes.
At the end of an overflowing article, it selects the final task even if its heading cannot reach the top.
The browser reproduced that case before the change.
A component regression fails without the page-end condition and passes with it.

## Verification

```sh
pnpm --filter @openldr/studio test src/pages/Docs.test.tsx src/docs
pnpm --filter @openldr/config test src/env-docs.test.ts
pnpm --filter @openldr/studio typecheck
pnpm --filter @openldr/studio build
node docs/review/user-guide/pinned-contents-evidence/check-pinned-contents.cjs
```

The Studio command passed 111 tests across 14 files.
All eight environment-doc tests passed. Typecheck returned zero.
The production build returned zero in 10.57 seconds.
Existing dependency annotation and bundle-size warnings remain.
The [recorded checks](pinned-contents-evidence/checks.json) include the failing regressions and passing commands.
These are documentation checks, not the full repository test suite.

The [browser proof](pinned-contents-evidence/browser-proof.json) passed these sizes in one resize sequence:

| Width | Height |
| --- | --- |
| 1600 | 500 |
| 1920 | 1080 |
| 1440 | 350 |
| 1280 | 720 |
| 1600 | 300 |
| 1600 | 1100 |
| 1279 | 720 |
| 1024 | 600 |
| 375 | 812 |

Desktop checks moved between earlier and later tasks and then returned upward.
The active task stayed fully visible, with zero independent wheel-scroll areas in the panel.
Wheel input over the panel moved the article.
The full menu supported an End-key jump to the final task at every size.
The panel's links also supported keyboard focus and Enter.
The title and panel stayed within the viewport on desktop.
No tested size had horizontal page overflow.
French and Portuguese both passed at 1440 by 350 after their translated content loaded.
No browser errors occurred. The original test account preferences were restored.

[The 1440 by 350 screenshot](pinned-contents-evidence/contents-1440x350.png) shows the panel at the final task.
All evidence screenshots use native device scale 4.
No normal database, guide content, screenshot source or runtime configuration changed.
Only the isolated account's display preferences changed during testing, then were restored.

HONEST NON-PROOF: headless layout cannot test retractable phone browser chrome.
Physical phone testing was not performed.

Repair commit `6ac8080a` was fast-forwarded to main.
The merged checks passed 16 Docs component tests and eight environment-doc tests.
`pnpm make:changelog` generated 3086 entries after the merge.
