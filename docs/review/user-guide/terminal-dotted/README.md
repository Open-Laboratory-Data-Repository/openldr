# Dotted window preview

Preview only. App docs and bundled app images are unchanged.

All 43 terminal and file-browser illustrations use the approved native frame.
Each frame has a blank title bar, three window controls and a 16px dotted margin.
The terminal and file browser use the same colours, border and title bar.
The frames use HTML and CSS, without a bitmap background.
Screenshots are lossless PNG at twice the layout resolution.

Commands, paths and Linux error transcripts retain their previous contents.
The operating-system selector still chooses the appropriate commands and paths.
Original illustrations remain under ../terminal-illustrations.
The earlier bitmap-based variant remains under ../terminal-neutral.
The previous standalone page is ../start-here-before-dotted.html.

Rebuild the illustrations with the repository's Playwright installation:

```sh
node docs/review/user-guide/terminal-dotted/build.cjs
```

PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH can select a custom Chromium binary.
Then rebuild the Start here standalone page with the existing guide-preview builder.

## App promotion

The approved images are now used by Start here in English, French and Portuguese.
Run promote.cjs to regenerate the transparent app PNGs from the approved native windows.
The app-manifest.json file records their names and checks that every image has transparent corners.

The app draws dots in DottedIllustration.css using the current theme's muted foreground colour.
The dots are clearest beside the window and fade toward the outer edges.
Only the dotted layer is masked. The terminal and file-browser images remain sharp.
The live page and image viewer share DottedIllustrationFrame.
The full Start here preview and the interactive theme render use the same CSS.

## Equal margins and theme contrast

The shared frame now reserves 24px on every side.
CSS crops the PNG's transparent margin. The source PNGs remain unchanged.
The rounded grid fits two rows along every edge, including the expanded image.
Light mode keeps 95% dot opacity. Dark mode uses 35%.
Both modes fade toward the outside edge.

`node docs/review/user-guide/terminal-dotted/check-surround.cjs` reports:

```text
PASS: two dot rows on every edge at 800, 736, 500, 375 and 320px in both themes.
PASS: light opacity 95%, dark opacity 35%; actual app uses shared styles.
```

Chromium also checked matching window crops in the page and expanded image.
This checks browser layout. It does not prove native Safari or physical-phone rendering.
