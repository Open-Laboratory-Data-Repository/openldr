import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { redactPaths, redactUrl } from './logger';

// Drive a pino logger with our redact paths into an in-memory stream and assert masking.
// (Return type is inferred — pino(opts, stream) yields a more specific Logger than the
// zero-arg ReturnType<typeof pino>, so an explicit annotation would mis-constrain it.)
function capture() {
  const chunks: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  const logger = pino({ redact: { paths: redactPaths, censor: '[redacted]' } }, stream);
  return { logger, lines: () => chunks.filter(Boolean).map((l) => JSON.parse(l)) };
}

describe('redactUrl', () => {
  it('redacts access_token value when it is the first query param', () => {
    expect(redactUrl('/api/x/build?access_token=secret123')).toBe('/api/x/build?access_token=[REDACTED]');
  });

  it('redacts access_token value when preceded by another param', () => {
    expect(redactUrl('/api/x/build?path=p&access_token=secret')).toBe('/api/x/build?path=p&access_token=[REDACTED]');
  });

  it('preserves params that follow access_token', () => {
    expect(redactUrl('/api/x?access_token=tok&other=keep')).toBe('/api/x?access_token=[REDACTED]&other=keep');
  });

  it('leaves URLs with no access_token unchanged', () => {
    expect(redactUrl('/api/x/build?path=p&foo=bar')).toBe('/api/x/build?path=p&foo=bar');
  });

  it('redacts the search value on patient list URLs only', () => {
    expect(redactUrl('/api/patients?search=MPI-0001&limit=25')).toBe('/api/patients?search=[redacted]&limit=25');
    expect(redactUrl('/api/patients?status=all&search=MPI-0001')).toBe('/api/patients?status=all&search=[redacted]');
    expect(redactUrl('/api/facilities?search=Chilenje')).toBe('/api/facilities?search=Chilenje');
  });

  it('leaves plain paths unchanged', () => {
    expect(redactUrl('/api/me')).toBe('/api/me');
  });
});

describe('logger redaction', () => {
  it('redacts a password key', () => {
    const { logger, lines } = capture();
    logger.error({ config: { password: 'hunter2' } }, 'boom');
    expect(JSON.stringify(lines())).not.toContain('hunter2');
    expect(JSON.stringify(lines())).toContain('[redacted]');
  });
  it('redacts a connectionString key', () => {
    const { logger, lines } = capture();
    logger.error({ connectionString: 'postgres://u:p@h/db' }, 'boom');
    expect(JSON.stringify(lines())).not.toContain('postgres://u:p@h/db');
  });
});

describe('log destination', () => {
  it('logs to stdout by default, and to stderr once the CLI asks', async () => {
    const { createLogger, sendLogsToStderr, logDestinationFd } = await import('./logger');
    const { symbols } = await import('pino');
    const fdOf = (l: unknown) => (l as Record<symbol, { fd?: number }>)[symbols.streamSym]?.fd;
    expect(logDestinationFd()).toBe(1);
    expect(fdOf(createLogger())).not.toBe(2);
    sendLogsToStderr();
    expect(logDestinationFd()).toBe(2);
    expect(fdOf(createLogger())).toBe(2);
  });
});

describe('LOG_FILE', () => {
  type Stream = { fd?: number; file?: string | null; destroy?: () => void };
  let dir: string;
  let saved: string | undefined;
  const opened: Stream[] = [];

  beforeEach(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    dir = mkdtempSync(join(tmpdir(), 'openldr-log-file-'));
    saved = process.env.LOG_FILE;
    delete process.env.LOG_FILE;
    // Fresh module each test, so one test's sendLogsToStderr() does not leak into the next.
    vi.resetModules();
  });

  afterEach(async () => {
    const { rmSync } = await import('node:fs');
    for (const s of opened.splice(0)) s.destroy?.();
    if (saved === undefined) delete process.env.LOG_FILE;
    else process.env.LOG_FILE = saved;
    rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function load() {
    const mod = await import('./logger');
    const { symbols } = await import('pino');
    const streamOf = (l: unknown): Stream => {
      const s = (l as Record<symbol, Stream>)[symbols.streamSym];
      opened.push(s);
      return s;
    };
    return { ...mod, streamOf };
  }

  it('writes log lines to LOG_FILE and nothing to standard output', async () => {
    const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const file = join(dir, 'logs', 'server.log');
    mkdirSync(join(dir, 'logs'));
    writeFileSync(file, 'earlier line\n');
    process.env.LOG_FILE = file;
    const { createLogger, streamOf } = await load();
    const logger = createLogger();
    logger.info('hello');
    const stream = streamOf(logger);
    expect(stream.file).toBe(file);
    expect(stream.fd).not.toBe(1);
    expect(stream.fd).not.toBe(2);
    // Written synchronously, in append mode: the earlier line is kept and the new one is there now.
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith('earlier line\n')).toBe(true);
    expect(text).toContain('"msg":"hello"');
  });

  it('creates the parent folder of LOG_FILE', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const file = join(dir, 'a', 'b', 'server.log');
    process.env.LOG_FILE = file;
    const { createLogger, streamOf } = await load();
    const logger = createLogger();
    logger.info('made the folder');
    streamOf(logger);
    expect(readFileSync(file, 'utf8')).toContain('made the folder');
  });

  it('writes to LOG_FILE and nothing to standard error after sendLogsToStderr()', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const file = join(dir, 'cli.log');
    process.env.LOG_FILE = file;
    const { createLogger, sendLogsToStderr, streamOf } = await load();
    sendLogsToStderr();
    const logger = createLogger();
    logger.info('from the cli');
    const stream = streamOf(logger);
    expect(stream.file).toBe(file);
    expect(stream.fd).not.toBe(1);
    expect(stream.fd).not.toBe(2);
    expect(readFileSync(file, 'utf8')).toContain('from the cli');
  });

  it('logs to standard output when LOG_FILE is unset', async () => {
    const { createLogger, streamOf } = await load();
    const stream = streamOf(createLogger());
    expect(stream.fd).toBe(1);
    expect(stream.file ?? null).toBeNull();
  });

  it('treats an empty LOG_FILE as unset', async () => {
    process.env.LOG_FILE = '';
    const { createLogger, streamOf } = await load();
    const stream = streamOf(createLogger());
    expect(stream.fd).toBe(1);
  });

  it('fails with the path when LOG_FILE cannot be opened', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // The parent "folder" is a plain file, so neither the folder nor the log can be created.
    const blocker = join(dir, 'not-a-folder');
    writeFileSync(blocker, '');
    const file = join(blocker, 'server.log');
    process.env.LOG_FILE = file;
    const { createLogger } = await load();
    expect(() => createLogger()).toThrow(file);
  });
});
