import { describe, expect, it } from 'vitest';
import { nativeSerial, refusalOf } from './serial-native';

describe('nativeSerial', () => {
  it('gives undefined when the browser has no serial feature, or the page is not secure', () => {
    const serial = { requestPort: async () => ({}), addEventListener() {}, removeEventListener() {} };
    expect(nativeSerial({} as Navigator, true)).toBeUndefined();
    expect(nativeSerial({ serial: undefined } as unknown as Navigator, true)).toBeUndefined();
    expect(nativeSerial({ serial } as unknown as Navigator, false)).toBeUndefined();
    expect(nativeSerial({ serial } as unknown as Navigator, true)).toBe(serial);
  });
});

describe('refusalOf', () => {
  it.each([
    ['NotFoundError', 'serial-cancelled'],
    ['SecurityError', 'serial-unavailable'],
    ['NotAllowedError', 'serial-unavailable'],
    ['NetworkError', 'serial-failed'],
    ['InvalidStateError', 'serial-failed'],
  ])('reads %s as %s', (name, refusal) => {
    expect(refusalOf(Object.assign(new Error('x'), { name }))).toBe(refusal);
  });

  it('reads anything that is not an error as serial-failed', () => {
    for (const odd of [undefined, null, 'NotFoundError', 42, {}]) expect(refusalOf(odd)).toBe('serial-failed');
  });
});
