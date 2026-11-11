// The options this plugin's wasm accepts (wasm/openldr-v1-import/src/queries.rs, parse_options).
// The wasm checks them again; these checks only stop an obviously wrong form early.
export interface OptionsForm { tz: string; database: string; from: string; to: string; panels: string }

export type OptionsProblem = 'tz' | 'database' | 'from' | 'to' | 'range' | 'panels';

const TZ = /^(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATABASE = /^[A-Za-z0-9_]{1,64}$/;
const PANEL = /^[A-Za-z0-9_.-]{1,40}$/;

/** The browser's own UTC offset, like +02:00, as a first guess for the site's offset. */
export function browserOffset(minutesWestOfUtc: number = new Date().getTimezoneOffset()): string {
  if (minutesWestOfUtc === 0) return 'Z';
  const east = -minutesWestOfUtc;
  const abs = Math.abs(east);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${east >= 0 ? '+' : '-'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

export function problems(form: OptionsForm): OptionsProblem[] {
  const out: OptionsProblem[] = [];
  const v = (s: string) => s.trim();
  if (!TZ.test(v(form.tz))) out.push('tz');
  if (v(form.database) && !DATABASE.test(v(form.database))) out.push('database');
  if (v(form.from) && !DATE.test(v(form.from))) out.push('from');
  if (v(form.to) && !DATE.test(v(form.to))) out.push('to');
  if (DATE.test(v(form.from)) && DATE.test(v(form.to)) && v(form.from) > v(form.to)) out.push('range');
  const panels = v(form.panels).split(',').map(v).filter(Boolean);
  if (panels.length > 50 || panels.some((p) => !PANEL.test(p))) out.push('panels');
  return out;
}

/** Only the options that were filled in, trimmed. An empty option is left out, not sent blank. */
export function toOptions(form: OptionsForm): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(form) as Array<[string, string]>) {
    const value = k === 'panels' ? raw.split(',').map((p) => p.trim()).filter(Boolean).join(',') : raw.trim();
    if (value) out[k] = value;
  }
  return out;
}

export function fromOptions(options: Record<string, string>): OptionsForm {
  return { tz: options.tz ?? '', database: options.database ?? '', from: options.from ?? '', to: options.to ?? '', panels: options.panels ?? '' };
}
