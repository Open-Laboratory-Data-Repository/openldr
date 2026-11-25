import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { HOST_FN_MAX_BYTES, type HostFn, type RunOptions } from './runner';

// Layer: the real test-sink-host wasm on the real Extism runner's worker path, with a fake host
// function. It proves an answer near HOST_FN_MAX_BYTES crosses from the main thread to the worker
// whole, although the SDK's shared buffer is 64 KB. Not proven here: CE's own host functions (see
// bootstrap host-fns.integration.test.ts). Run `pnpm build:test-sink` first; the test skips without
// the built wasm.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink-host', 'plugin.wasm');

const quiet = { log() {}, progress() {} };

function opts(answer: unknown): RunOptions {
  const ceRead: HostFn = async () => answer;
  const unused: HostFn = async () => ({ ok: false, error: { code: 'UNUSED', message: 'not part of this test' } });
  return {
    entrypoint: 'host_ce_read',
    wasi: true,
    memoryMb: 64,
    timeoutMs: 30_000,
    host: quiet,
    hostFns: { ce_read: ceRead, db_select: unused, db_write: unused, fhir_emit: unused },
  };
}

/** A host answer whose JSON is `bytes` long. */
function answerOf(bytes: number): { ok: true; result: { text: string } } {
  const shell = JSON.stringify({ ok: true, result: { text: '' } });
  return { ok: true, result: { text: 'x'.repeat(bytes - shell.length) } };
}

describe.skipIf(!existsSync(wasmPath))('host function answers on the worker path', () => {
  const wasm = existsSync(wasmPath) ? new Uint8Array(readFileSync(wasmPath)) : new Uint8Array();
  const input = new TextEncoder().encode(JSON.stringify({ op: 'testCatalog.get', input: {} }));

  for (const bytes of [70_000, HOST_FN_MAX_BYTES - 10]) {
    it(`passes a ${bytes}-byte answer to the plugin whole`, async () => {
      const answer = answerOf(bytes);
      expect(Buffer.byteLength(JSON.stringify(answer))).toBe(bytes);
      const out = await createExtismRunner().run(wasm, input, opts(answer));
      const seen = JSON.parse(new TextDecoder().decode(out));
      expect(seen.ok).toBe(true);
      expect(seen.result.text.length).toBe(answer.result.text.length);
    }, 60_000);
  }

  it('answers TOO_LARGE, not a broken call, one byte over the limit', async () => {
    const out = await createExtismRunner().run(wasm, input, opts(answerOf(HOST_FN_MAX_BYTES + 1)));
    const seen = JSON.parse(new TextDecoder().decode(out));
    expect(seen.ok).toBe(false);
    expect(seen.error.code).toBe('TOO_LARGE');
  }, 60_000);
});
