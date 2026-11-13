// The wire format of a command sent through the app. Both directions are lines of JSON
// (application/x-ndjson), one frame per line. Bytes travel as base64, at most MAX_DATA_BYTES of them
// in one frame.
//
// The client sends `start`, then each input file as `file`, `data`..., `end`, then `go`. The server
// answers with `run`, then `out` and `err` as the command prints, then each output file as `file`,
// `data`..., `end`, then `exit`. A refusal before `run` is a plain HTTP answer, not a frame.
//
// This file imports nothing but ./handoff, because the server bundles it through
// `@openldr/cli/wire` and it must pull in no command code (wire.test.ts checks it).

export { SERVED_FD, SERVED_FD_ENV, type ServedHandoff } from './handoff';

/** A path value in argv is '@@' + ref, alone or after `--flag=`. */
export const PATH_PLACEHOLDER = '@@';

/** What a ref may look like. A ref is only compared with placeholders, never used in a path. */
export const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The most file bytes one `data` frame carries, before base64. */
export const MAX_DATA_BYTES = 64 * 1024;

/** The longest line either side accepts, newline not counted. */
export const MAX_LINE_BYTES = 1024 * 1024;

export type ClientFrame =
  | {
      t: 'start'; version: string; path: string; argv: string[];
      inputs: { ref: string; kind: 'input-file' | 'input-dir'; name: string; keep: boolean }[];
      outputs: { ref: string; kind: 'output-file' | 'output-dir' }[];
    }
  /** Opens a file. rel is '' for the main file of an input-file. */
  | { t: 'file'; ref: string; rel: string }
  /** Bytes of the open file. */
  | { t: 'data'; d: string }
  /** Closes the open file. */
  | { t: 'end' }
  | { t: 'go' };

export type ServerFrame =
  | { t: 'run'; id: string }
  | { t: 'out'; d: string }
  | { t: 'err'; d: string }
  | { t: 'file'; ref: string; rel: string }
  | { t: 'data'; d: string }
  | { t: 'end' }
  /** `stopped` is true when OpenLDR itself stopped and interrupted the command. Absent otherwise,
   *  and an older server never sends it. */
  | { t: 'exit'; code: number; stopped?: true }
  /** A failure after `run` was sent. */
  | { t: 'error'; message: string };

/** A line that is too long or is not a frame. The message never quotes the line. */
export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

export function encodeFrame(f: ClientFrame | ServerFrame): string {
  return `${JSON.stringify(f)}\n`;
}

const NEWLINE = 0x0a;

function parseLine(line: Buffer): unknown {
  let value: unknown;
  try {
    value = JSON.parse(line.toString('utf8'));
  } catch {
    throw new FrameError('A line is not JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as { t?: unknown }).t !== 'string') {
    throw new FrameError('A line is not a frame.');
  }
  return value;
}

/**
 * The frames in a byte stream, in order. Lines are split on bytes, so a letter cut across two chunks
 * is whole again before it is read. Throws FrameError on a line over MAX_LINE_BYTES, as soon as it is
 * over, on an empty line, and on a line that is not a JSON object with a string `t`. The shape
 * beyond `t` is the reader's to check.
 */
export async function* decodeFrames<T>(source: AsyncIterable<Uint8Array>): AsyncIterable<T> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  const tooLong = () => new FrameError(`A line is longer than ${MAX_LINE_BYTES} bytes.`);
  for await (const chunk of source) {
    const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let start = 0;
    for (;;) {
      const nl = buf.indexOf(NEWLINE, start);
      if (nl < 0) break;
      const piece = buf.subarray(start, nl);
      if (pendingBytes + piece.length > MAX_LINE_BYTES) throw tooLong();
      const line = pendingBytes > 0 ? Buffer.concat([...pending, piece]) : piece;
      pending = [];
      pendingBytes = 0;
      start = nl + 1;
      // encodeFrame never writes one, and skipping them would let a body of newlines cost time
      // with no bound.
      if (line.length === 0) throw new FrameError('A line is empty.');
      yield parseLine(line) as T;
    }
    if (start < buf.length) {
      const rest = buf.subarray(start);
      if (pendingBytes + rest.length > MAX_LINE_BYTES) throw tooLong();
      // A copy: the source may reuse its buffer for the next chunk.
      pending.push(Buffer.from(rest));
      pendingBytes += rest.length;
    }
  }
  if (pendingBytes > 0) yield parseLine(Buffer.concat(pending)) as T;
}
