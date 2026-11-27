import { describe, expect, it } from 'vitest';
import { isOpenElsewhere, registerOpenPorts } from './serial-registry';
import type { SerialPortLike } from './serial-gate';

const port = (): SerialPortLike => ({ open: async () => {}, close: async () => {}, readable: null, writable: null, getInfo: () => ({}) });

describe('the serial registry', () => {
  it('says a port is open elsewhere only when another source holds it', () => {
    const a = port();
    const b = port();
    const mine = () => [a];
    const theirs = () => [b];
    const removeMine = registerOpenPorts(mine);
    const removeTheirs = registerOpenPorts(theirs);
    try {
      expect(isOpenElsewhere(b, mine)).toBe(true);
      // My own port is not "elsewhere".
      expect(isOpenElsewhere(a, mine)).toBe(false);
      expect(isOpenElsewhere(a, theirs)).toBe(true);
      expect(isOpenElsewhere(port(), mine)).toBe(false);
    } finally { removeMine(); removeTheirs(); }
  });

  it('reads each source when asked, not when it was added', () => {
    const a = port();
    const held: SerialPortLike[] = [];
    const theirs = () => held;
    const remove = registerOpenPorts(theirs);
    try {
      expect(isOpenElsewhere(a, () => [])).toBe(false);
      held.push(a);
      expect(isOpenElsewhere(a, () => [])).toBe(true);
    } finally { remove(); }
  });

  it('forgets a source when it is removed', () => {
    const a = port();
    const remove = registerOpenPorts(() => [a]);
    expect(isOpenElsewhere(a, () => [])).toBe(true);
    remove();
    expect(isOpenElsewhere(a, () => [])).toBe(false);
  });

  it('is not stopped by a source that throws', () => {
    const a = port();
    const removeBad = registerOpenPorts(() => { throw new Error('gone'); });
    const removeGood = registerOpenPorts(() => [a]);
    try { expect(isOpenElsewhere(a, () => [])).toBe(true); } finally { removeBad(); removeGood(); }
  });
});
