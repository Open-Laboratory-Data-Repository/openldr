# Deployment and developer docs review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| A1 | This app page has its own deployment editor. | REFUTED | `apps/studio/src/docs/0.1.8/en/advanced-docs.md:3` directs deployment work to external documentation. | Keep the guide as navigation and reference. |
| A2 | The guide omits saving instructions before downtime. | CONFIRMED | The original page has no export steps. `apps/studio/src/pages/Docs.tsx:378` exposes Download documentation. | Add and exercise export instructions. |
| A3 | Reproject rebuilds terminology only. | REFUTED | `apps/studio/src/docs/0.1.8/en/advanced-docs.md:14` already says the rebuild covers the complete warehouse. | Preserve that distinction. |
| A4 | The reference topics have no step screenshots. | CONFIRMED | The original page contains no images or screenshot names. `apps/studio/src/docs/registry.ts:840` declares an empty list. | Capture navigation, download and phone reading. |

The preview has 9 numbered steps and 9 native screenshot frames.
Desktop originals are 5120 by 3200. Phone originals are 1500 by 3248.
The original page and pictures remain unchanged.

## Actual navigation and export

The browser used isolated Studio 5189 and API 3009.
It opened Docs, searched Deployment, chose the matching guide and read its repository link.
It opened Download documentation, chose This page, then Markdown.
The actual downloaded file is preserved as exported-advanced-docs.md.
The filename is recorded in download-proof.json.
The phone capture shows the actual guide heading at 375 by 812.

Source review checked the warehouse notes against:
`packages/db/src/migrations/external/019_v1_request_facts.ts:10`,
`packages/db/src/migrations/external/020_lab_result_comparator.ts:8`,
`packages/db/src/migrations/external/024_lab_result_status.ts:11`, and
`packages/db/src/relational-writer.ts:128` for arrival-ledger writes.
The request-attribute terminology file exists at the documented source-checkout path.
No clinical schema or queries were changed.

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-advanced-docs.cjs`
printed `ADVANCED DOCS CAPTURE PASS`.
`python3 docs/review/user-guide/write-guide-article.py advanced-docs` printed `9 numbered steps`.
`python3 docs/review/user-guide/build-guide.py advanced-docs 'Deployment and developer docs'`
printed `9 equal screenshot frames, 9 steps, 9 original captures`.
`node docs/review/user-guide/check-guide-preview.cjs advanced-docs` returned zero missing screenshots,
no broken anchors, native width 5120, blur, phone overflow false and HTTP 200.

## Limits

HONEST NON-PROOF: exporting a guide does not establish a recoverable deployment backup.
PDF and Word export were not repeated here. Markdown was downloaded through the actual app.
External website navigation, Windows installation, production deployment and reproject were not executed.
A real phone must confirm any bottom-edge controls with retractable browser chrome.
No production documentation, translation, shared navigation, commit or push changed here.
