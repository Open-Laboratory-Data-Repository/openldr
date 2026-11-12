# Start here window preview

Preview only. The app documentation and its bundled images are unchanged.

The user approved approved-terminal.png as the common window frame.
The terminal and file browser both use that image as their background.
There is no title text, tab strip, plus button, or down arrow in the title bar.
The original minimize, maximize and close controls remain in the shared frame.

The 43 generated illustrations retain the previous commands, paths and Linux proof transcripts.
The Windows startup banner was removed so the initial terminal uses the same quiet frame.
The operating-system selector still chooses the correct shell commands and paths.
The original images remain under ../terminal-illustrations.
The previous standalone page is ../start-here-before-neutral.html.

To rebuild the illustrations after editing scene.html or build.cjs:

```sh
node docs/review/user-guide/terminal-neutral/build.cjs
```

The renderer uses the repository's Playwright installation. A custom Chromium binary can be selected with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
Then rebuild the standalone pages with the existing guide-review build.py.
