import { describe, expect, it } from 'vitest';
import { parseServerAddress } from './server-address';

describe('parseServerAddress', () => {
  it.each([
    ['labpc', 'https://labpc/studio/'],
    ['labpc:3443', 'https://labpc:3443/studio/'],
    ['  HTTPS://LabPC:3443/studio/#x  ', 'https://labpc:3443/studio/'],
    ['https://192.168.1.20:3443', 'https://192.168.1.20:3443/studio/'],
    ['192.168.1.20:3443', 'https://192.168.1.20:3443/studio/'],
    ['https://hub.example.org/studio/orders?x=1', 'https://hub.example.org/studio/'],
    ['hub.example.org/studio', 'https://hub.example.org/studio/'],
    ['https://hub.example.org:443', 'https://hub.example.org/studio/'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000/studio/'],
    ['[fd00::20]:3443', 'https://[fd00::20]:3443/studio/'],
    ['https://labpc:3443/studio/', 'https://labpc:3443/studio/'],
  ])('reads %j as %s', (input, address) => {
    expect(parseServerAddress(input)).toMatchObject({ ok: true, address });
  });

  it('gives the origin, the host and the port', () => {
    expect(parseServerAddress('labpc')).toEqual({ ok: true, address: 'https://labpc/studio/', origin: 'https://labpc', host: 'labpc', port: 443 });
    expect(parseServerAddress('labpc:3443')).toMatchObject({ port: 3443, origin: 'https://labpc:3443' });
    expect(parseServerAddress('http://127.0.0.1')).toMatchObject({ port: 80, host: '127.0.0.1' });
    expect(parseServerAddress('[fd00::20]:3443')).toMatchObject({ host: 'fd00::20', port: 3443 });
  });

  it('gives the same address for one server typed in many shapes', () => {
    const shapes = ['labpc:3443', ' labpc:3443 ', 'LABPC:3443', 'https://labpc:3443', 'HTTPS://LabPC:3443/studio/', 'https://labpc:3443/studio/orders?x=1#y'];
    expect(new Set(shapes.map((s) => (parseServerAddress(s) as { address: string }).address))).toEqual(new Set(['https://labpc:3443/studio/']));
  });

  it('reads its own answer back as the same address', () => {
    for (const input of ['labpc', 'labpc:3443', '[fd00::20]:3443', 'http://127.0.0.1:3000']) {
      const first = parseServerAddress(input) as { address: string };
      expect(parseServerAddress(first.address)).toMatchObject({ ok: true, address: first.address });
    }
  });

  it.each([
    ['', 'empty'], ['   ', 'empty'],
    ['http://labpc', 'not-https'], ['http://localhost:3000', 'not-https'], ['http://192.168.1.20:3000', 'not-https'], ['HTTP://LabPC', 'not-https'],
    // A name that only looks like the loopback address is not it.
    ['http://127.0.0.1.example.org', 'not-https'],
    ['ftp://labpc', 'unreadable'], ['file:///etc/passwd', 'unreadable'], ['javascript:alert(1)', 'unreadable'],
    ['https://user:pw@labpc', 'unreadable'], ['https://user@labpc', 'unreadable'], ['https://', 'unreadable'], ['lab pc', 'unreadable'],
    ['labpc:99999', 'unreadable'], ['https://labpc:0', 'unreadable'],
  ])('refuses %j as %s', (input, reason) => {
    expect(parseServerAddress(input)).toEqual({ ok: false, reason });
  });
});
