// Tools for the long how-to guides: screenshots, short MP4 clips, and a visible cursor.
//
// A guide script drives the real studio the way a person would. `shot()` saves a PNG.
// `clip()` records the steps inside it as an MP4, plus a PNG poster of the last frame. The
// poster is what the PDF and Word exports show, because neither can hold a video.
//
// Clips come from Chromium's own screencast (sharp frames, each with a timestamp), not from
// Playwright's recordVideo (soft VP8). ffmpeg turns the frames into H.264, which plays in every
// browser the docs run in, phones included. Set FFMPEG_PATH when ffmpeg is not on PATH.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CDPSession, Locator, Page } from '@playwright/test';

import { addCallouts, removeCallouts, type Callout } from '../capture-docs/capture-helpers';

/** Same folder the existing doc screenshots use, so both docs viewers already find them. */
export const OUT = fileURLToPath(new URL('../../apps/studio/src/docs/0.1.0/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

export const VIEWPORT = { width: 1440, height: 900 };
const CLIP_WIDTH = 1280;
const HOLD_LAST_FRAME_S = 1.5;

function ffmpeg(): string {
  return process.env.FFMPEG_PATH ?? 'ffmpeg';
}

/** A dot that follows the mouse, with a ring on each click. Headless Chromium draws no cursor. */
const CURSOR_SCRIPT = `
(() => {
  if (window.__docCursor) return;
  window.__docCursor = true;
  const install = () => {
    const dot = document.createElement('div');
    dot.setAttribute('data-doc-cursor', '');
    Object.assign(dot.style, {
      position: 'fixed', left: '0px', top: '0px', width: '18px', height: '18px',
      marginLeft: '-9px', marginTop: '-9px', borderRadius: '9999px',
      background: 'rgba(255,255,255,0.92)', border: '2px solid #2f80a8',
      boxShadow: '0 2px 8px rgba(0,0,0,0.45)', pointerEvents: 'none', zIndex: '2147483647',
      display: 'none',
    });
    document.body.append(dot);
    window.addEventListener('mousemove', (e) => {
      dot.style.display = 'block';
      dot.style.left = e.clientX + 'px';
      dot.style.top = e.clientY + 'px';
    }, true);
    window.addEventListener('mousedown', (e) => {
      const ring = document.createElement('div');
      Object.assign(ring.style, {
        position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: '36px', height: '36px',
        marginLeft: '-18px', marginTop: '-18px', borderRadius: '9999px', border: '3px solid #2f80a8',
        pointerEvents: 'none', zIndex: '2147483646', opacity: '1', transform: 'scale(0.4)',
        transition: 'transform 380ms ease-out, opacity 380ms ease-out',
      });
      document.body.append(ring);
      requestAnimationFrame(() => { ring.style.transform = 'scale(1.3)'; ring.style.opacity = '0'; });
      setTimeout(() => ring.remove(), 450);
    }, true);
  };
  if (document.body) install(); else document.addEventListener('DOMContentLoaded', install);
})();
`;

export async function prepareGuidePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('openldr-theme', 'dark');
      localStorage.setItem('openldr-locale', 'en');
      localStorage.setItem('i18nextLng', 'en');
    } catch {
      // Storage can be blocked. The defaults are fine then.
    }
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.addInitScript(CURSOR_SCRIPT);
}

/** Open a studio route and wait until the app shell is drawn. */
export async function open(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.locator('nav').first().waitFor({ state: 'visible', timeout: 30_000 });
  await settle(page);
}

/** Wait for requests to finish, then one more beat for charts to draw. */
export async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}

let mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Move the visible cursor to the middle of an element, at a speed a reader can follow. */
export async function point(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`no box for ${target.toString()}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const distance = Math.hypot(x - mouse.x, y - mouse.y);
  await page.mouse.move(x, y, { steps: Math.max(8, Math.round(distance / 25)) });
  mouse = { x, y };
}

export async function click(page: Page, target: Locator, pauseMs = 350): Promise<void> {
  await point(page, target);
  await page.waitForTimeout(150);
  await target.click();
  await page.waitForTimeout(pauseMs);
}

export async function type(page: Page, target: Locator, text: string): Promise<void> {
  await click(page, target, 100);
  await target.fill('');
  await target.pressSequentially(text, { delay: 45 });
  await page.waitForTimeout(250);
}

/** Pick an item from a shadcn Select: open the trigger, then click the option by its text. */
export async function choose(page: Page, trigger: Locator, option: string): Promise<void> {
  await click(page, trigger, 250);
  await click(page, page.getByRole('option', { name: option, exact: true }), 300);
}

export interface ShotOptions {
  /** Crop to this element, with some room around it. */
  crop?: Locator;
  pad?: number;
  callouts?: Callout[];
}

/** Save a PNG of the page, or of one region of it. */
export async function shot(page: Page, name: string, options: ShotOptions = {}): Promise<void> {
  // Park the mouse on the top bar, so no chart tooltip or hover colour ends up in the picture.
  const size = page.viewportSize() ?? VIEWPORT;
  await page.mouse.move(size.width / 2, 8, { steps: 4 });
  mouse = { x: size.width / 2, y: 8 };
  await settle(page, 250);
  await page.evaluate(() => {
    const dot = document.querySelector<HTMLElement>('[data-doc-cursor]');
    if (dot) dot.style.visibility = 'hidden';
  });
  if (options.callouts?.length) await addCallouts(page, options.callouts);
  try {
    const path = join(OUT, `${name}.png`);
    if (options.crop) {
      const box = await options.crop.boundingBox();
      if (!box) throw new Error(`no box for crop of ${name}`);
      const pad = options.pad ?? 16;
      const x = Math.max(0, box.x - pad);
      const y = Math.max(0, box.y - pad);
      await page.screenshot({
        path,
        clip: {
          x, y,
          width: Math.min(size.width - x, box.width + pad * 2),
          height: Math.min(size.height - y, box.height + pad * 2),
        },
      });
    } else {
      await page.screenshot({ path });
    }
    compressPng(join(OUT, `${name}.png`));
  } finally {
    await removeCallouts(page).catch(() => undefined);
    await page.evaluate(() => {
      const dot = document.querySelector<HTMLElement>('[data-doc-cursor]');
      if (dot) dot.style.visibility = 'visible';
    });
  }
}

/**
 * Rewrite a PNG with a 256-colour palette. A dark UI screenshot halves in size, and the
 * difference is not visible next to the original. Dithering is off so flat colours stay flat.
 */
function compressPng(path: string): void {
  const tmp = `${path}.tmp.png`;
  execFileSync(ffmpeg(), [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', path,
    '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none',
    tmp,
  ]);
  renameSync(tmp, path);
}

interface Frame { data: string; ts: number }

/**
 * Record the steps inside `steps` as `<name>.mp4`, and save the last frame as `<name>.png`.
 * Keep clips short: one task, 5 to 20 seconds.
 */
export async function clip(page: Page, name: string, steps: () => Promise<void>): Promise<void> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push({ data: frame.data, ts: frame.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1,
  });
  // Nudge the page so the first frame arrives before the first step.
  await page.mouse.move(mouse.x + 1, mouse.y);
  await page.waitForTimeout(400);
  try {
    await steps();
    await settle(page, 600);
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
  if (frames.length === 0) throw new Error(`clip ${name}: no frames captured`);
  encode(name, frames);
  await shot(page, name);
}

function encode(name: string, frames: Frame[]): void {
  const dir = mkdtempSync(join(tmpdir(), `guide-${name}-`));
  try {
    const lines: string[] = [];
    frames.forEach((frame, i) => {
      const file = `f${String(i).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, file), Buffer.from(frame.data, 'base64'));
      const next = frames[i + 1]?.ts;
      const duration = next ? Math.max(0.01, next - frame.ts) : HOLD_LAST_FRAME_S;
      lines.push(`file '${file}'`, `duration ${duration.toFixed(3)}`);
    });
    // The concat demuxer ignores the last duration unless the last file is listed again.
    lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
    writeFileSync(join(dir, 'frames.txt'), lines.join('\n') + '\n');
    const out = join(OUT, `${name}.mp4`);
    execFileSync(ffmpeg(), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
      '-vf', `fps=25,scale=${CLIP_WIDTH}:-2:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an', out,
    ]);
    const kb = Math.round(statSync(out).size / 1024);
    process.stdout.write(`clip ${name}.mp4: ${frames.length} frames, ${kb} KB\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
