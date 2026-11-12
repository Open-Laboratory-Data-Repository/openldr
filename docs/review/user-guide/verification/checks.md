# Review checkpoint checks

## Documentation code

`pnpm --filter @openldr/studio test src/docs`

Output: 13 test files passed, 91 tests passed.
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
The image lightbox opened the original 1280 by 800 capture.
Start here switched all 13 terminal images between Linux, macOS and Windows.
Windows instructions showed C:\openldr_ce and PowerShell commands, with no remaining Unix folder commands.
All three languages fit a 375 by 812 viewport without page overflow.
English also fit a 320 by 812 viewport.
See browser-checks.json and the app screenshots in the parent folder.

The standalone Dashboard preview contains 32 equal frames.
Each inner frame measured 498 by 311.25 pixels, inside a 500-pixel button.
The background filter was blur(1.25px). No comparison toggle was present.
The lightbox opened the original full capture.
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
