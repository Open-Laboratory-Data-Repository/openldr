# Plugin cards and side panels review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| PS1 | The original panel instructions lack step pictures. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/plugin-sites.md:15` lists panel steps without images. | Add native evidence for each action. |
| PS2 | Switching places off disables the whole plugin. | REFUTED | `apps/studio/src/pages/settings/marketplace/PluginSitesSheet.tsx:41` updates one place. Live proof retained its main-menu entry. | Explain independent switches. |
| PS3 | A panel loses its content on page navigation. | REFUTED | `apps/studio/src/plugins/PluginPanelHost.tsx:8` mounts outside page routes. The live test kept the same saved note while moving to Forms. | Show page navigation with the panel open. |
| PS4 | The sample reference plugin has unreadable dark-theme text. | CONFIRMED | `reference-plugins/ui-reference/ui.html:2` sets fixed dark text. | Use light theme for this sample. No source fix. |

The preview has 18 numbered steps and 18 native screenshot frames.
Desktop originals are 5120 by 3200. Phone originals are 1500 by 3248.
No published guide or existing screenshot changed.

## Live workflows

Only isolated API 3009, Studio 5189, Postgres 15442 and the worker's own S3 bucket received writes.
The existing built reference plugin was installed with the CLI into that isolated instance.
The install transcript printed `installed ui-reference@0.1.0`.
No real external reports, credentials or source data were used.

The browser read Drawn in: widget inside the dashboard card iframe.
It opened Side panels, chose Reference panel and read Drawn in: panel.
It used the sample's Save + reload note action and waited for the changed note.
After navigating to Forms, the same note remained visible.
It closed the panel and opened Marketplace, Installed, ui-reference and Places.
It turned both places off, observed saved switches and captured the remaining plugin-page link.
The API proof reports both places off.
Both places were then restored for phone evidence and future review.
The final API proof reports no disabled places.

`pnpm openldr market sites ui-reference` exited 0 and listed declared places.
The transcript is in plugin-sites-evidence/cli-sites.txt.

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-plugin-sites.cjs`
printed `PLUGIN SITES CAPTURE PASS`.
`python3 docs/review/user-guide/write-guide-article.py plugin-sites` printed `18 numbered steps`.
`python3 docs/review/user-guide/build-guide.py plugin-sites 'Plugin cards and side panels'`
printed `18 equal screenshot frames, 18 steps, 18 original captures`.
`node docs/review/user-guide/check-guide-preview.cjs plugin-sites` checks native resolution,
step evidence, focus bounds, anchors, common lightbox and phone preview overflow.
The result is in plugin-sites-evidence/preview-checks.json.

## Limits

HONEST NON-PROOF: role-restricted plugin visibility and sign-out closure were checked in source.
They were not exercised through separate authenticated accounts in this bypass installation.
The reference plugin demonstrates plugin presentation and local storage, not a production integration.
The phone capture uses headless Chromium. A real phone must confirm bottom-edge access with browser chrome.
No application fix, production publication, translation, shared navigation, commit or push was made here.
