# Review checkpoint checks

## Documentation code

`pnpm --filter @openldr/studio test src/docs`

Output: 13 test files passed, 92 tests passed.
This checks Markdown rendering, asset references, heading links, platform changes, and export parsing.
It does not prove the app instructions match every product state.

`pnpm --filter @openldr/web test src/docs`

Output: 3 test files passed, 29 tests passed.
The existing jsdom window.scrollTo warnings remain. They did not fail the tests.

`pnpm --filter @openldr/studio typecheck`

Output: `tsc --noEmit`, exit 0.

`pnpm --filter @openldr/web typecheck`

Output: `tsc --noEmit`, exit 0.

`pnpm --filter @openldr/studio build`

Output: `built in 10.18s`, exit 0.
The build emitted the new screenshot assets. Existing dependency annotation and chunk-size warnings remain.

`python3 docs/review/user-guide/build.py`

Output: `Dashboard: 23 original full-screen captures, 32 equal frames` and `Start here: 43 illustrations`.
It also rebuilt successfully when invoked by absolute path from outside the checkout.

## Browser checks

Headless Chromium opened the actual Studio docs through the development server.
English, French and Portuguese each showed the new Create task.
The image lightbox retained the page crop, blur and numbered marker.
Start here switched all 13 terminal images between Linux, macOS and Windows.
Windows instructions showed C:\openldr_ce and PowerShell commands, with no remaining Unix folder commands.
All three languages fit a 375 by 812 viewport without page overflow.
English also fit a 320 by 812 viewport.
See browser-checks.json and the app screenshots in the parent folder.

The standalone Dashboard preview contains 32 equal frames.
Each inner frame measured 498 by 311.25 pixels, inside a 500-pixel button.
The background filter was blur(1.25px). No comparison toggle was present.
The lightbox retained the page crop, blur and markers.
The preview fit 375- and 320-pixel viewports without page overflow.
No JavaScript page errors were reported.

These checks prove browser rendering and switching only.
HONEST NON-PROOF: a real phone has not confirmed the layout with retractable browser chrome.
Native Windows and macOS command execution was not tested.

## App behavior and CLI evidence

The earlier live Create test is recorded in ../create-dashboard-focus/capture-manifest.json.
It created one dashboard through the UI, checked the persisted empty result, and removed only that record.
It restored the sidebar preference and recorded unchanged existing dashboards.
No other Dashboard task received a new live behavior test in this checkpoint.

results.json contains 17 installed-launcher command records.
It includes expected failures and their successful recovery commands.
dev-results.json contains six successful source CLI command records.
The earlier tests used isolated services and one Organization fixture.
They did not reset the populated database or verify full restored service startup.

## Focused image expansion

`pnpm --filter @openldr/studio test src/docs` reported 92 tests passed after this correction.
`pnpm --filter @openldr/studio typecheck` exited 0.

A headless browser compared the page and expanded rendering for all four app Create screenshots and all 32 Dashboard preview frames.
Their source images, crop coordinates, clipped sharp layers, background blur and markers matched.
The app retained the focus effect after using Zoom in.
Both expanded views fit a 375 by 812 viewport without page overflow.
See focused-lightbox.json and the matching-expanded screenshots.
Original full captures remain unchanged on disk.

## Merged main

The merge in 13511e2b preserved the newer main changes without conflicts.
On the merged code, `pnpm --filter @openldr/studio test src/docs` reported 92 tests passed.
`pnpm --filter @openldr/studio typecheck` exited 0.
`pnpm --filter @openldr/studio build` reported built in 10.71s and exited 0.
`pnpm make:changelog` reported 3074 entries across 88 days.
These checks cover documentation behavior and compilation. They do not retest unrelated application features.

## Full Dashboard promotion and neutral illustrations

The operator approved the full Dashboard preview as the app guide's starting point.
The app now includes the own-data widget walkthrough, sample setup, and both practice exercises in en/fr/pt.
The existing permissions, refresh, rename, SQL, layout and export reference remains below the walkthrough.

`pnpm --filter @openldr/studio test src/docs` reported 92 tests passed.
`pnpm --filter @openldr/studio typecheck` exited 0.
`pnpm --filter @openldr/studio build` reported built in 9.78s and exited 0.
An incoming-link check reported `Broken incoming Dashboard heading links: []` for all three languages.

Headless Chromium counted 32 focused screenshot placements in each language.
The expanded widget screenshot retained blur(1.25px).
All three language pages fit a 375 by 812 viewport without page overflow.
No new live widget behavior test was run. The promoted images come from the approved preview's existing recordings.

The neutral terminal and file browser are illustrations for review.
Their standalone page fit 736-, 375- and 320-pixel widths without page overflow.
No JavaScript page errors were reported.
Start here's existing OS-specific content and pictures were not changed.

## Start here images and theme-aware surrounds

The approved native terminal and file-browser images are now referenced by Start here in en/fr/pt.
All 43 app PNGs have transparent corners, verified during generation.
Original bundled images and earlier preview versions remain preserved.

`pnpm --filter @openldr/studio test src/docs` reported 94 tests passed.
`pnpm --filter @openldr/web test src/docs` reported 29 tests passed.
`pnpm --filter @openldr/studio typecheck` exited 0.
`pnpm --filter @openldr/studio build` reported built in 10.49s and exited 0.
The existing build annotation warnings and documentation test warnings remain.

The browser checked live light/dark theme switching, transparent margins, matching image-viewer backgrounds, and zoom.
Each operating-system selection displayed 17 themed image placements.
The page fit a 375px viewport. The interactive render fit 320px without overflow.
The later fade check used the app's data-theme attribute to inspect both colour schemes.
It confirmed theme-aware dots, intersected edge gradients and no mask on the foreground image.
See terminal-dotted/theme-verification.json and terminal-dotted/fade-verification.json.
The Light and Dark buttons on start-here-theme-review.html were also checked.

These checks cover documentation rendering and asset integrity.
No CLI command behavior changed or received a new execution test.
PDF and Word exports use the transparent PNGs. Their static pages do not render the live CSS dot layer.
HONEST NON-PROOF: a physical phone and native Safari have not been checked in this slice.
