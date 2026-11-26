# Plugin print API: `openldr.print.pages`

Date: 2026-11-26. Asked for by Codex for the lab-bench sample tracking manifest. Approved by the operator.

## Why

Sample tracking already draws a shipment manifest as ordered A4 PNG pages. A plugin page cannot
print them. Its frame runs with `sandbox="allow-scripts"` only (`PluginFrame.tsx`), and without
`allow-modals` a page's own `window.print()` does nothing.

## What

`await openldr.print.pages({ title, paper: 'A4', pages })`, where `pages` is an ordered list of PNG
data URLs. It resolves when the print dialog closes, printed or cancelled. It cannot tell which.

## Approaches

- **Studio prints from a frame of its own (chosen).** It follows `files.download`: a `host.` operation
  the studio answers itself, with one check shared by the host and the mock.
- **Add `allow-modals` to the plugin frame.** Rejected. It hands every plugin every modal dialog, and
  the printout would include whatever the page shows, buttons and all.
- **Server renders a PDF.** Rejected. The pages hold patient data, and the request was that nothing
  goes to the server.

## How

- SDK: `host.print` operation, `print.pages` in the bootstrap and the mock, `checkPrint` and `pngSize` in `print.ts`.
- Checks: title 1 to 120 characters, paper `A4` only, 1 to 100 pages, each a `data:image/png;base64,`
  URL with a PNG signature and IHDR header, each 1 to 10,000 pixels a side, 64 MB of characters in all.
  Refusals are short fixed sentences that never quote the title or a page.
- Studio: `print-frame.ts`. A hidden iframe with `sandbox="allow-same-origin allow-modals"`, no
  scripts, and a CSP that allows data images and inline style only. One sheet per page,
  `@page { size: A4; margin: 0 }`, each image fitted with its shape kept. It waits for
  `img.decode()` on every page, calls the frame's `print()`, and removes the frame on `afterprint`, or
  on the studio window's next focus as a fallback. A page that will not decode is refused.
- One print open at a time per plugin frame. Leaving the page removes an open print frame.

## Not covered

- No CLI part. It is a browser dialog.
- No user guide change. `files.download` is documented in its type comments only, and so is this.
- Mobile printing, iOS Safari especially, needs a real phone.
- Headless Chrome never sends `afterprint`. There the frame stays until the plugin page unmounts.
