import { describe, it, expect } from 'vitest';
import {
  checkSerialSettings, checkSerialWrite, clampSerialWait,
  SERIAL_BUFFER_MAX, SERIAL_MAX_OPEN, SERIAL_READ_MAX, SERIAL_WAIT_MAX_MS, SERIAL_WRITE_MAX, SERIAL_WRITE_QUEUE_MAX,
} from './serial';

describe('the serial limits', () => {
  it('are the ones the design names', () => {
    expect([SERIAL_MAX_OPEN, SERIAL_READ_MAX, SERIAL_BUFFER_MAX, SERIAL_WRITE_MAX, SERIAL_WRITE_QUEUE_MAX, SERIAL_WAIT_MAX_MS])
      .toEqual([2, 65_536, 1_048_576, 65_536, 1_048_576, 30_000]);
  });
});

describe('checkSerialSettings', () => {
  it.each([299, 921601, 9600.5, '9600', NaN, undefined, null, -9600, Infinity])('refuses the speed %j', (baudRate) => {
    expect(checkSerialSettings({ baudRate })).toBe('serial-bad-settings');
  });

  it('accepts 9600 with no other field, and a full set of fields', () => {
    expect(checkSerialSettings({ baudRate: 9600 })).toBeNull();
    expect(checkSerialSettings({ baudRate: 300 })).toBeNull();
    expect(checkSerialSettings({ baudRate: 921600 })).toBeNull();
    expect(checkSerialSettings({ baudRate: 115200, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' })).toBeNull();
    expect(checkSerialSettings({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'odd', flowControl: 'none' })).toBeNull();
    expect(checkSerialSettings({ baudRate: 9600, parity: 'none' })).toBeNull();
  });

  it.each([{ dataBits: 6 }, { stopBits: 3 }, { parity: 'mark' }, { flowControl: 'xon' }, { dataBits: '8' }, { stopBits: null }])('refuses %j', (extra) => {
    expect(checkSerialSettings({ baudRate: 9600, ...extra })).toBe('serial-bad-settings');
  });

  it.each([undefined, null, 'x', 9600, []])('refuses settings that are not an object: %j', (settings) => {
    expect(checkSerialSettings(settings)).toBe('serial-bad-settings');
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])('refuses a field named %s without throwing', (name) => {
    const settings = JSON.parse(`{"baudRate":9600,"${name}":1}`) as unknown;
    expect(checkSerialSettings(settings)).toBe('serial-bad-settings');
  });

  it('refuses a field the design does not have, such as a control line', () => {
    expect(checkSerialSettings({ baudRate: 9600, dtr: true })).toBe('serial-bad-settings');
    expect(checkSerialSettings({ baudRate: 9600, bufferSize: 1 << 30 })).toBe('serial-bad-settings');
  });
});

describe('checkSerialWrite', () => {
  it('refuses a write that is not bytes, is empty, or is over the limit', () => {
    expect(checkSerialWrite('abc')).toBe('serial-too-large');
    expect(checkSerialWrite([1, 2, 3])).toBe('serial-too-large');
    expect(checkSerialWrite(new Uint16Array(4))).toBe('serial-too-large');
    expect(checkSerialWrite(new ArrayBuffer(4))).toBe('serial-too-large');
    expect(checkSerialWrite(undefined)).toBe('serial-too-large');
    expect(checkSerialWrite(new Uint8Array(0))).toBe('serial-too-large');
    expect(checkSerialWrite(new Uint8Array(SERIAL_WRITE_MAX + 1))).toBe('serial-too-large');
  });

  it('accepts a write of exactly 65536 bytes', () => {
    expect(checkSerialWrite(new Uint8Array(65_536))).toBeNull();
    expect(checkSerialWrite(new Uint8Array(1))).toBeNull();
  });
});

describe('clampSerialWait', () => {
  it('clamps a wait to 0..30000 and turns a bad value into 0', () => {
    expect(clampSerialWait(0)).toBe(0);
    expect(clampSerialWait(250)).toBe(250);
    expect(clampSerialWait(30_000)).toBe(30_000);
    expect(clampSerialWait(30_001)).toBe(30_000);
    expect(clampSerialWait(Infinity)).toBe(0);
    expect(clampSerialWait(-5)).toBe(0);
    expect(clampSerialWait(12.7)).toBe(12);
    for (const bad of [NaN, '100', undefined, null, {}]) expect(clampSerialWait(bad)).toBe(0);
  });
});
