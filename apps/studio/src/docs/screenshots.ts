// Bundled documentation screenshots and clips, keyed by bare filename (e.g. `dashboard.png`).
// They live in 0.1.0/screenshots/ and are emitted as hashed assets by Vite. Markdown
// references them by basename, ![alt](dashboard.png), resolved through this map.
//
// A clip is a short MP4 with a PNG poster of the same name beside it (`x.mp4` and `x.png`).
// The viewer plays the MP4. PDF and Word export cannot hold video, so they print the poster.
// e2e/capture-guides writes both files.
const urls = import.meta.glob('./0.1.0/screenshots/*.{png,mp4}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export const SCREENSHOTS: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([p, url]) => [p.split('/').pop() ?? p, url]),
);

export function makeResolver(map: Record<string, string>) {
  return function resolveImg(src: string): string | null {
    if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
    return map[src] ?? null;
  };
}

export const resolveImg = makeResolver(SCREENSHOTS);

/** True for a clip reference (`name.mp4`), with or without a query string. */
export function isClip(src: string): boolean {
  return /\.mp4(\?.*)?$/i.test(src);
}

/** The poster image name for a clip: `name.mp4` becomes `name.png`. Other names pass through. */
export function posterName(src: string): string {
  return src.replace(/\.mp4(\?.*)?$/i, '.png');
}
