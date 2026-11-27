import { describe, expect, it } from 'vitest';
import { checkPin, makeLock, MIN_PIN_LENGTH, pinGate, WRONG_PIN_WAIT_MS } from './lock';

/** A sleep that waits until the test lets it go, and records what it was asked for. */
function heldSleep() {
  const asked: number[] = [];
  const releases: Array<() => void> = [];
  return {
    asked,
    sleep: (ms: number) => new Promise<void>((resolve) => { asked.push(ms); releases.push(resolve); }),
    release: () => releases.splice(0).forEach((r) => r()),
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('makeLock and checkPin', () => {
  it('accepts the PIN it was made with and refuses another', () => {
    const lock = makeLock('1234');
    expect(checkPin(lock, '1234')).toBe(true);
    expect(checkPin(lock, '1235')).toBe(false);
    expect(checkPin(lock, '')).toBe(false);
  });

  it('gives a different salt and hash each time', () => {
    const a = makeLock('1234');
    const b = makeLock('1234');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('stores a 16 byte salt and a 32 byte hash as lower case hex, and never the PIN', () => {
    const lock = makeLock('83917');
    expect(lock.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(lock.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(lock)).not.toContain('83917');
  });

  it('refuses a malformed lock', () => {
    expect(checkPin({ salt: 'zz', hash: '' }, '1234')).toBe(false);
    expect(checkPin({ salt: '', hash: '' }, '')).toBe(false);
    const lock = makeLock('1234');
    expect(checkPin({ salt: lock.salt, hash: lock.hash.slice(0, 10) }, '1234')).toBe(false);
    expect(checkPin({ salt: lock.salt, hash: `${lock.hash}00` }, '1234')).toBe(false);
  });

  it('asks for at least four characters', () => {
    expect(MIN_PIN_LENGTH).toBe(4);
  });
});

describe('pinGate', () => {
  it('waits two seconds before it answers a wrong PIN', async () => {
    const held = heldSleep();
    const gate = pinGate(makeLock('1234'), held.sleep);
    let answer: string | undefined;
    void gate.submit('0000').then((a) => { answer = a; });
    await settle();
    expect(held.asked).toEqual([WRONG_PIN_WAIT_MS]);
    expect(WRONG_PIN_WAIT_MS).toBe(2_000);
    expect(answer).toBeUndefined();
    held.release();
    await settle();
    expect(answer).toBe('wrong');
  });

  it('does not check a second PIN during that wait', async () => {
    const held = heldSleep();
    const gate = pinGate(makeLock('1234'), held.sleep);
    const first = gate.submit('0000');
    await settle();
    expect(await gate.submit('1234')).toBe('busy');
    held.release();
    expect(await first).toBe('wrong');
    // The wait is over: the right PIN is checked again.
    expect(await gate.submit('1234')).toBe('ok');
  });

  it('answers the right PIN at once', async () => {
    const held = heldSleep();
    const gate = pinGate(makeLock('1234'), held.sleep);
    expect(await gate.submit('1234')).toBe('ok');
    expect(held.asked).toEqual([]);
  });
});
