# F01 Start here callouts

## Evidence and scope

The gap would be false if Start here already had numbered navigation and matching report instructions.
`apps/studio/src/docs/0.1.0/en/start-here.md:7` originally promised numbered screenshots.
The original manifest entry at `apps/studio/src/docs/0.1.0/screenshot-manifest.json:9` had no callouts.
`e2e/capture-docs/capture-helpers.ts:80` already implements callouts, so no annotation dependency was needed.
`apps/studio/src/shell/AppShell.tsx:31` includes Facilities in current navigation.
`apps/studio/src/pages/Reports.tsx:260` places Parameters in a sheet opened from the actions menu.

## Approved plan and changes

1. Reuse the screenshot manifest and callout helper.
2. Capture current navigation, the Parameters menu entry, and the Parameters sheet.
3. Match numbers 1 through 6 in English, French, and Portuguese Studio guides.
4. Add the same entry journey and image copies to public getting-started documentation.
5. Verify captures using synthetic browser responses, without a backend or global setup.

The navigation image includes Facilities. Cropped images keep labels readable without arrows.
The capture stops before Run. It uses an invented text parameter rather than clinical vocabulary.
The default docs capture excludes these synthetic shots. Their dedicated configuration regenerates them.

## Reproduce and verification

From this worktree's `apps/studio`, start the frontend with:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort
```

From the worktree root:

```powershell
node e2e/node_modules/@playwright/test/cli.js test --config e2e/start-here-capture.config.ts
node --import tsx --test e2e/capture-docs/manifest.test.ts
Copy-Item apps/studio/src/docs/0.1.0/screenshots/start-here*.png apps/web/public/docs-images/
```

Capture output: `1 passed`. Manifest output: `pass 1`, `fail 0`.
The capture intercepts every API request, aborts non-GET requests, and asserts no writes were attempted.
Service workers are blocked. The configuration has no global setup or backend server.

From `apps/studio`:

```powershell
node ../../node_modules/vitest/vitest.mjs run src/docs/registry.test.ts src/docs/validation.test.ts
```

Output: `Test Files 2 passed`, `Tests 31 passed`.
These tests verify guide registration, references, and asset presence. They do not test a live report.
All three screenshots were visually inspected. Number 6 was moved inside the sheet crop after inspection.
The capture also checks the required input and Run visibility at 375 by 812.

## Limits

HONEST NON-PROOF: no real phone was tested. Headless Chromium cannot verify retractable browser chrome.
No report was run. No live API, database seed, default global setup, commit, merge, or push was used.
CLI parity is inapplicable because this changes documentation and capture tooling only.
The changelog remains for an authorized merge to main, as required by AGENTS.md.
