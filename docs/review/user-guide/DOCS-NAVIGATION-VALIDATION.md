# Documentation navigation on phones

The operator approved moving Version below Search, right-aligning its value, and preventing the phone sidebar from squeezing the article.
The changes use the existing worktree on `codex/docs-version-navigation`.

The old sidebar expanded as a normal flex column at `apps/studio/src/pages/Docs.tsx:282-284` before this repair.
That took width from the reading pane. The new phone layout uses the existing Sheet component as a left-hand overlay.
The reading pane keeps its width and scroll position while navigation is open.
Choosing a guide closes the sheet, including choosing the current guide again.
Escape, the close control and tapping outside also close it.
Focus stays within the sheet and returns to its opener after dismissal.
Both phone open and close controls have 44-pixel tap targets.
The sheet uses `h-dvh` to follow the visible viewport height.
Desktop navigation remains an inline, collapsible column.
Resizing an open phone sheet to desktop removes the overlay. Returning to phone width closes navigation.

Version now sits below Search and above the guide links.
Its value sits next to the arrow on the right, with a measured gap of four pixels.
The existing version options and state remain in use.
No new translation keys were added. The sheet's accessible title uses the existing translated navigation label.
The English, French and Portuguese layouts were checked.

## Commands and results

```sh
pnpm --filter @openldr/studio test src/pages/Docs.test.tsx src/docs
pnpm --filter @openldr/config test src/env-docs.test.ts
pnpm --filter @openldr/studio typecheck
pnpm --filter @openldr/studio build
node docs/review/user-guide/docs-navigation-evidence/check-navigation.cjs
```

The Studio command passed 113 tests across 14 files.
The two new phone-navigation regressions failed before the repair. The Docs component file now passes all 18 tests.
The environment-doc command passed eight tests. Typecheck returned zero.
The production build returned zero in 12.33 seconds.
Existing dependency annotation and bundle-size warnings remain.
These checks cover documentation UI and formatting. They do not exercise the whole repository.
[Recorded commands and output](docs-navigation-evidence/checks.json) preserve the results.

The [browser proof](docs-navigation-evidence/browser-proof.json) passed these sizes:

| Width | Height | Navigation |
| --- | --- | --- |
| 320 | 640 | Phone sheet |
| 375 | 812 | Phone sheet |
| 393 | 812 | Phone sheet |
| 767 | 700 | Phone sheet |
| 768 | 700 | Inline sidebar |
| 1024 | 768 | Inline sidebar |
| 1280 | 800 | Inline sidebar |
| 1920 | 1080 | Inline sidebar |

At width 375, the reading pane stayed 327 pixels wide before and after opening the sheet.
At width 393, it stayed 345 pixels wide. The existing 48-pixel navigation rail remains.
Every phone size passed search, selection, long-list reachability, focus containment, Escape, outside dismissal and focus return.
The version menu opened within the sheet. Its value remained right-aligned at every size.
All sizes had no horizontal page overflow. The 767/768 breakpoint and an open-sheet resize sequence passed.
French and Portuguese passed at 375 by 812.
The browser recorded zero errors and zero server mutations.
Its locale checks override only private browser read responses. No saved preferences changed.

[Phone navigation open](docs-navigation-evidence/phone-open-393.png) and [article after selection](docs-navigation-evidence/phone-reading-393.png) show the result.
All evidence screenshots use native device scale 4.
No database, guide prose, existing screenshot source, public web layout or CLI behavior changed.

HONEST NON-PROOF: headless Chromium cannot test retractable phone browser chrome.
Only a real phone can confirm bottom-edge access with its browser bars visible.
Physical phone testing was not performed.
