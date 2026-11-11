# Guide captures

Scripts that make the screenshots and short clips for the long how-to guides. One script per
guide: `<slug>.guide.ts` makes the media for `apps/studio/src/docs/<version>/<locale>/<slug>.md`.

Each script drives the real studio the way a reader would, with a visible cursor. Rerun it
whenever the studio UI changes, and every picture in that guide is retaken the same way.

## What it writes

Into `apps/studio/src/docs/0.1.0/screenshots/`, the folder both docs viewers read:

- `name.png`, a screenshot.
- `name.mp4` and `name.png` together, a clip and its poster. The viewers play the MP4. PDF and
  Word export print the poster, because they cannot hold video.

Clips are H.264 at 1280 by 800, made from Chromium's own screencast frames. Most are 50 to
250 KB. List every file in the guide's `capturedNames` in `apps/studio/src/docs/registry.ts`.
The docs tests fail if one is missing, or if a clip has no poster.

## Before you run it

1. A server on a fresh install, with no other lab data. The guides quote exact numbers.
2. The docs sample data loaded into it:

   ```bash
   pnpm openldr ingest apps/web/public/docs-samples/openldr-sample-lab-data.json
   ```

   `make-sample-data.mjs` writes that file. It is deterministic, so rerunning it gives the same
   bytes. Change it only together with the numbers in the guides.
3. `AUTH_DEV_BYPASS=true` on that server, so the script is signed in as an administrator.
4. ffmpeg with libx264. Set `FFMPEG_PATH` if it is not on `PATH`.

## Run it

```bash
PORT=3200 FFMPEG_PATH=/path/to/ffmpeg pnpm --filter @openldr/e2e docs:guides
```

`PORT` is the server's port, 3000 by default. One guide only:
`pnpm --filter @openldr/e2e docs:guides dashboard.guide.ts`. If this Playwright version's
Chromium is not downloaded, point `CHROMIUM_PATH` at a Chromium you already have.

Each script puts back what it changed: the sample dashboard, settings it switched, and anything
it created. Running it twice in a row gives the same pictures.
