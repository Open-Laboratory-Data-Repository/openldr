// Layer under test: the wire format both ends of a through-the-app command speak (wire.ts), and the
// rule that the files the server bundles from the CLI pull in nothing else.
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  decodeFrames, encodeFrame, FrameError, MAX_DATA_BYTES, MAX_LINE_BYTES, PATH_PLACEHOLDER, REF_PATTERN,
  SERVED_FD, SERVED_FD_ENV, type ClientFrame, type ServerFrame,
} from './wire';

async function* chunks(...parts: Array<string | Uint8Array>): AsyncIterable<Uint8Array> {
  for (const p of parts) yield typeof p === 'string' ? Buffer.from(p) : p;
}

async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const f of source) out.push(f);
  return out;
}

const EVERY: Array<ClientFrame | ServerFrame> = [
  {
    t: 'start', version: '0.1.11', path: 'export', argv: ['--out', '@@abc'],
    inputs: [{ ref: 'in1', kind: 'input-file', name: 'données é.csv', keep: false }],
    outputs: [{ ref: 'abc', kind: 'output-dir' }],
  },
  { t: 'file', ref: 'in1', rel: '' },
  { t: 'data', d: Buffer.from('héllo').toString('base64') },
  { t: 'end' },
  { t: 'go' },
  { t: 'run', id: 'r'.repeat(43) },
  { t: 'out', d: 'AAEC' },
  { t: 'err', d: '' },
  { t: 'exit', code: 3 },
  { t: 'error', message: 'stopped' },
];

describe('wire', () => {
  it('round-trips every frame, and decodes frames split across chunks and several in one chunk', async () => {
    const text = EVERY.map(encodeFrame).join('');
    expect(EVERY.map(encodeFrame).every((l) => l.endsWith('\n') && l.indexOf('\n') === l.length - 1)).toBe(true);

    // One chunk with every frame in it.
    expect(await all(decodeFrames(chunks(text)))).toEqual(EVERY);

    // Every possible cut, as bytes, including inside a multi-byte letter.
    const bytes = Buffer.from(text);
    for (const at of [1, 7, 60, 61, 62, 63, bytes.length - 1]) {
      expect(await all(decodeFrames(chunks(bytes.subarray(0, at), bytes.subarray(at))))).toEqual(EVERY);
    }
    // One byte at a time.
    const single = [...bytes].map((b) => Uint8Array.of(b));
    expect(await all(decodeFrames(chunks(...single)))).toEqual(EVERY);

    // A last line with no newline still counts.
    expect(await all(decodeFrames(chunks('{"t":"go"}')))).toEqual([{ t: 'go' }]);
  });

  it('refuses a line over 1 MiB, before it has all of it', async () => {
    expect(MAX_LINE_BYTES).toBe(1024 * 1024);
    let pulled = 0;
    async function* endless(): AsyncIterable<Uint8Array> {
      for (;;) {
        pulled += 1;
        yield Buffer.alloc(64 * 1024, 97);
      }
    }
    await expect(all(decodeFrames(endless()))).rejects.toThrow(FrameError);
    expect(pulled).toBeLessThan(20);
    // Exactly at the limit is allowed.
    const line = `{"t":"out","d":"${'A'.repeat(MAX_LINE_BYTES - 18)}"}`;
    expect(Buffer.byteLength(line)).toBe(MAX_LINE_BYTES);
    expect(await all(decodeFrames(chunks(`${line}\n`)))).toHaveLength(1);
    await expect(all(decodeFrames(chunks(`{"t":"out","d":"${'A'.repeat(MAX_LINE_BYTES - 17)}"}\n`)))).rejects.toThrow(FrameError);
  });

  it('refuses an empty line, so a body of newlines stops at the first', async () => {
    let pulled = 0;
    async function* newlines(): AsyncIterable<Uint8Array> {
      for (;;) {
        pulled += 1;
        yield Buffer.alloc(64 * 1024, 10);
      }
    }
    await expect(all(decodeFrames(newlines()))).rejects.toThrow('A line is empty.');
    expect(pulled).toBe(1);
    await expect(all(decodeFrames(chunks('{"t":"go"}\n\n{"t":"go"}\n')))).rejects.toThrow(FrameError);
    await expect(all(decodeFrames(chunks('{"t":"go"}\n', '\n')))).rejects.toThrow(FrameError);
  });

  it('refuses a line that is not a JSON object with a type, without quoting it', async () => {
    for (const bad of ['nope\n', '[1]\n', '"x"\n', '{"d":"secret-value"}\n', '{"t":3}\n']) {
      const err = await all(decodeFrames(chunks(bad))).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FrameError);
      expect((err as Error).message).not.toContain('secret-value');
      expect((err as Error).message).not.toContain('nope');
    }
  });

  it('names the limits and the placeholder the plan fixed', () => {
    expect(PATH_PLACEHOLDER).toBe('@@');
    expect(MAX_DATA_BYTES).toBe(64 * 1024);
    expect(SERVED_FD).toBe(3);
    expect(SERVED_FD_ENV).toBe('OPENLDR_SERVED_FD');
    expect(REF_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(REF_PATTERN.test('a'.repeat(65))).toBe(false);
    for (const bad of ['', 'a/b', '..', 'a b', 'é', 'a\n']) expect(REF_PATTERN.test(bad)).toBe(false);
    expect(REF_PATTERN.test('Ab_9-x')).toBe(true);
  });
});

// The server bundles these three files (R4). Each may import only Node built-ins and the other two.
describe('the files the server bundles', () => {
  const FILES = ['wire.ts', 'handoff.ts', 'command-meta.ts'];
  const ALLOWED = new Set(['./wire', './handoff', './command-meta']);
  const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

  it.each(FILES)('%s imports only Node built-ins and the other two', (file) => {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const specifiers = [
      ...text.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm),
      ...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
      ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]!);
    const bad = specifiers.filter((s) => !builtins.has(s) && !ALLOWED.has(s));
    expect(bad).toEqual([]);
  });

  it('the package exports both files under the names the server imports', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, string> };
    expect(pkg.exports['./meta']).toBe('./src/command-meta.ts');
    expect(pkg.exports['./wire']).toBe('./src/wire.ts');
  });
});
