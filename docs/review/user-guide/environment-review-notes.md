# Environment variables review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| E1 | Guide conflates a runtime default with deployment defaults. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/environment.md:25` lists production. `packages/config/src/schema.ts:14` defaults the parser to development. | Distinguish parser and deployed settings. |
| E2 | Studio offers an environment-file editor. | REFUTED | `apps/studio/src/pages/settings/General.tsx:183` exposes About, not private environment values. Startup configuration is read by `packages/config/src/schema.ts:12`. | Explain server-side editing and use illustrations. |
| E3 | Changing initial-registry variables replaces saved registries. | REFUTED | `apps/studio/src/docs/0.1.8/en/environment.md:229` already says the variables only seed the first registry. | Preserve the saved-registry rule. |
| E4 | The original environment guide has no step pictures. | CONFIRMED | `apps/studio/src/docs/registry.ts:779` declares no screenshots for Environment variables. | Add actual About evidence and clearly labelled terminal illustrations. |

The preview has 8 numbered steps and 8 native screenshot frames.
Sources are 5120 by 3200. Every command illustration is explicitly labelled Illustration.
The terminal frame copies the approved neutral three-control style and faded dotted margins.
Focus follows the command rather than an empty terminal body.
No actual deployment configuration was changed for these illustrations.
Original published documentation remains unchanged.

## Source and runtime checks

The live About pictures use only isolated API 3009 and Studio 5189.
The reference tables were checked against `packages/config/src/schema.ts`.
The runtime, adapter, database, S3, OIDC, workflow, plugin, crash-loop and marketplace values
come from that parser. Compose-only image and gateway values are labelled deployment values.
Saved registry and sync configuration is distinguished from startup defaults.

`pnpm --filter @openldr/config test` passed 8 test files and 92 tests.
That layer checks parsing, validation and configuration selection.
It does not prove a production Compose edit, container recreation or external service connection.
The complete output remains in /tmp/openldr-guides-system-config-tests.log.

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-environment.cjs`
printed `ENVIRONMENT CAPTURE PASS`.
The illustration renderer checks exactly three blank-titlebar window controls.
`python3 docs/review/user-guide/write-guide-article.py environment` printed `8 numbered steps`.
`python3 docs/review/user-guide/build-guide.py environment 'Environment variables'` checks focus bounds.
`node docs/review/user-guide/check-guide-preview.cjs environment` checks native resolution,
step evidence, anchors, lightbox and phone preview overflow. See preview-checks.json.

## Limits

HONEST NON-PROOF: the Compose commands are instructional illustrations, not live deployment results.
No production env file, gateway address, trust store, database engine or credential was changed.
The About page is a live screenshot; it does not expose the private .env file.
A physical phone and native terminal rendering were not tested.
No translations, shared navigation, application changes, commits or pushes were made here.
