import { describe, expect, it } from 'vitest';
import { eventSink, type LauncherEvent } from './events.js';

describe('eventSink', () => {
  it('writes one JSON object and a newline per event to the descriptor', () => {
    const writes: Array<[number, string]> = [];
    const emit = eventSink(3, (fd, text) => writes.push([fd, text]));
    const events: LauncherEvent[] = [
      { event: 'starting', step: 'postgres' },
      { event: 'ready', address: 'http://localhost:3990/studio/' },
      { event: 'stopped', result: 'clean' },
    ];
    for (const e of events) emit(e);
    expect(writes).toEqual(events.map((e) => [3, `${JSON.stringify(e)}\n`]));
  });

  it('does not throw when the write throws, as it does when the reader has gone', () => {
    const emit = eventSink(3, () => {
      throw Object.assign(new Error('EPIPE: broken pipe, write'), { code: 'EPIPE' });
    });
    expect(() => emit({ event: 'stopping' })).not.toThrow();
    expect(() => emit({ event: 'error', message: 'boom' })).not.toThrow();
  });
});
