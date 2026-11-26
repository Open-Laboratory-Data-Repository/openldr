/** The paper sizes a page may ask the host to print on. */
export type PluginPrintPaper = 'A4';

/** The most pages one print may hold. */
export const PRINT_MAX_PAGES = 100;
/** The most characters all the pages' data URLs may hold together. */
export const PRINT_MAX_CHARS = 64 * 1024 * 1024;
/** The widest and tallest a page's image may be, in pixels. A4 at 300 dpi is 2480 by 3508. */
export const PRINT_MAX_PIXELS = 10_000;
/** The longest title, in UTF-16 units. */
export const PRINT_MAX_TITLE = 120;

const PREFIX = 'data:image/png;base64,';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The width and height a PNG data URL's header gives, or null when it is not a PNG data URL.
 *  Reads the signature and the IHDR chunk only: the first 24 bytes, 32 base64 characters. */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  if (!dataUrl.startsWith(PREFIX)) return null;
  const body = dataUrl.slice(PREFIX.length);
  if (body.length < 32 || body.length % 4 !== 0 || !BASE64.test(body)) return null;
  let head: string;
  try { head = atob(body.slice(0, 32)); } catch { return null; }
  for (let i = 0; i < SIGNATURE.length; i++) if (head.charCodeAt(i) !== SIGNATURE[i]) return null;
  if (head.slice(12, 16) !== 'IHDR') return null;
  const u32 = (at: number) => ((head.charCodeAt(at) << 24) >>> 0) + (head.charCodeAt(at + 1) << 16) + (head.charCodeAt(at + 2) << 8) + head.charCodeAt(at + 3);
  return { width: u32(16), height: u32(20) };
}

/** The host's check of a page's request to print. Null means it may be printed. Otherwise a short
 *  fixed error that never quotes the title or a page. Every field is checked as if it were not typed. */
export function checkPrint(input: unknown): string | null {
  const { title, paper, pages } = (input ?? {}) as { title?: unknown; paper?: unknown; pages?: unknown };
  if (typeof title !== 'string' || title.trim() === '' || title.length > PRINT_MAX_TITLE) return 'print refused: bad title';
  if (paper !== 'A4') return 'print refused: bad paper';
  if (!Array.isArray(pages) || pages.length === 0) return 'print refused: no pages';
  if (pages.length > PRINT_MAX_PAGES) return `print refused: over ${PRINT_MAX_PAGES} pages`;
  let chars = 0;
  for (const page of pages) {
    if (typeof page !== 'string') return 'print refused: a page is not a PNG';
    chars += page.length;
    if (chars > PRINT_MAX_CHARS) return 'print refused: the pages are over 64 MB';
  }
  for (const page of pages as string[]) {
    const size = pngSize(page);
    if (!size) return 'print refused: a page is not a PNG';
    if (size.width < 1 || size.height < 1 || size.width > PRINT_MAX_PIXELS || size.height > PRINT_MAX_PIXELS) {
      return 'print refused: a page is too large';
    }
  }
  return null;
}
