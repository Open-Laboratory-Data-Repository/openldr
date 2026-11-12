# Published user guides

The operator approved publishing all 27 remaining guides on main.
The published Markdown under `apps/studio/src/docs/0.1.8/{en,fr,pt}/` is now the editing source.
The standalone review pages and original captures remain an archive. Production guides do not load them.

The publication includes:

- Test catalog, Patients, Forms and Workflows.
- Reports, Activity, Scheduled reports with workflows, Query and Report Designer.
- Layouts, Users, Roles, Audit, Settings, Setup checks, Laboratory and Data Exposure.
- Distributed sync, Connectors, Diagnose connections and Import from OpenLDR v1.
- Marketplace, Plugin cards and side panels, Authentication providers and Environment variables.
- Planned upgrades and Deployment and developer docs.

Each language has 775 numbered steps and 913 screenshot placements across these guides.
Every numbered step has an image. The 905 distinct published image names retain their original native bytes.
Framing metadata preserves the focused crop, blurred context and numbered targets.
Sixteen images have multiple targets. The viewer now preserves each target and its marker in those frames.
The previously approved pages retain their rendering behavior.

All 18 optional files are under `apps/web/public/docs-samples/user-guide/`.
Their built website copies match byte for byte. No fictional data is required for normal use.
Facilities, Test catalog and patient setup remain optional and strongly recommended.
The website Getting started page explains the updated in-app guides in all three languages.

# Verification

The worktree baseline passed 94 Studio docs tests and 29 website docs tests.

Final commands and outputs:

| Command | Output |
| --- | --- |
| `python3 docs/review/user-guide/finalize-publication.py` | PUBLICATION INTEGRITY PASS: 27 guides, 775 steps and 913 frames per locale, 905 native assets, 18 downloads. |
| `pnpm --filter @openldr/studio test src/docs src/pages/Docs.test.tsx` | 14 files passed, 108 tests passed. |
| `pnpm --filter @openldr/web test src/docs` | 3 files passed, 29 tests passed. |
| `pnpm --filter @openldr/studio typecheck` | tsc --noEmit, exit 0. |
| `pnpm --filter @openldr/web typecheck` | tsc --noEmit, exit 0. |
| `pnpm --filter @openldr/studio build` | Built in 12.43 seconds. |
| `pnpm --filter @openldr/web build` | Built in 4.22 seconds. |
| `node docs/review/user-guide/check-published-guides.cjs` | PUBLISHED GUIDES PASS 81. |
| Final deployment-link browser check | DEPLOYMENT LINKS PASS 3. |

`publication-integrity.json` records translation structure, command parity and native image checks.
`published-browser-checks.json` records all 81 real Studio pages, light theme, multiple-target enlargement and phone width.
Every page retained the same frame when enlarged. No browser errors occurred.
`published-deployment-links.json` checks the final website and source links in all three locales.
Screenshots are in `publication-evidence/`.

The old text-only Settings and deployment assertions were updated for their approved illustrated guides.
The multi-target lightbox test checks that all three connector fields remain outlined while zooming.
The deployment guide keeps its captured navigation title and includes actual website and repository links.
CLI samples use the installed launcher from the installation folder, with Windows and development alternatives linked to Start here.

# Limits and scope

These tests prove documentation registration, locale structure, image availability and actual viewer rendering.
They do not prove every application workflow described by the guides. Earlier live workflow proofs remain in each section's review notes.
The route tests do not prove the nullable PostgreSQL fields behind the report status failure.
The browser check used the owned isolated API on port 3006. It changed only that account's display preferences.
No normal database was reset, seeded or migrated for publication.

HONEST NON-PROOF: 375 by 812 headless layout has no horizontal page overflow, but it cannot prove retractable phone browser chrome.
No physical phone, production deployment, historical release upgrade or large all-guide PDF/Word export was tested.
The build retains dependency-annotation and bundle-size warnings. The release gallery capture was not run.
Public sample files were checked in the website build, not on an external deployment.

No app bug repair is part of this publication. `BUGS.md` separates seven confirmed issues from three refuted suspicions.
The main merge, changelog generation and push are recorded in the final HANDOFF entry.
