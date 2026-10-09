import { describe, it, expect } from 'vitest';
import { parseThirdPartyList, imageRefs, badImageRefs, replaceDigest, pinnedRef } from './third-party';

const D1 = `sha256:${'a'.repeat(64)}`;
const D2 = `sha256:${'b'.repeat(64)}`;
const list = parseThirdPartyList(JSON.stringify({
  images: [{ name: 'postgres', upstream: 'postgres:16-alpine', copy: 'ghcr.io/open-laboratory-data-repository/postgres:16-alpine', digest: D1 }],
  exceptions: [{ image: 'mcr.microsoft.com/mssql/server:2022-latest', reason: 'licence' }],
}));

describe('imageRefs', () => {
  it('reads compose image lines', () => {
    const text = 'services:\n  db:\n    image: postgres:16-alpine\n  x:\n    image: "nginx:1.27"\n';
    expect(imageRefs(text, 'compose')).toEqual(['postgres:16-alpine', 'nginx:1.27']);
  });
  it('reads Dockerfile FROM lines and drops the stage name', () => {
    const text = 'FROM node:22 AS build\nRUN x\nFROM --platform=linux/amd64 nginx:1.27-alpine\n';
    expect(imageRefs(text, 'dockerfile')).toEqual(['node:22', 'nginx:1.27-alpine']);
  });
  it('ignores a FROM that names an earlier stage', () => {
    expect(imageRefs('FROM node:22 AS build\nFROM build AS final\n', 'dockerfile')).toEqual(['node:22']);
  });
});

describe('badImageRefs', () => {
  it('accepts a pinned copy from the list', () => {
    expect(badImageRefs([pinnedRef(list.images[0]!)], list)).toEqual([]);
  });
  it('accepts our own images', () => {
    expect(badImageRefs(['ghcr.io/open-laboratory-data-repository/openldr-api:${OPENLDR_VERSION:-latest}'], list)).toEqual([]);
  });
  it('accepts a listed exception', () => {
    expect(badImageRefs(['mcr.microsoft.com/mssql/server:2022-latest'], list)).toEqual([]);
  });
  it('rejects a vendor image', () => {
    expect(badImageRefs(['postgres:16-alpine'], list)).toEqual(['postgres:16-alpine']);
  });
  it('rejects a copy without the digest', () => {
    expect(badImageRefs(['ghcr.io/open-laboratory-data-repository/postgres:16-alpine'], list)).toHaveLength(1);
  });
  it('rejects a copy pinned to a stale digest', () => {
    expect(badImageRefs([`ghcr.io/open-laboratory-data-repository/postgres:16-alpine@${D2}`], list)).toHaveLength(1);
  });
});

describe('parseThirdPartyList', () => {
  it('refuses an entry whose copy is not under our GHCR org', () => {
    expect(() => parseThirdPartyList(JSON.stringify({
      images: [{ name: 'x', upstream: 'x:1', copy: 'docker.io/x:1', digest: '' }], exceptions: [],
    }))).toThrow(/ghcr\.io\/open-laboratory-data-repository/);
  });
});

describe('replaceDigest', () => {
  it('swaps the digest on every pinned reference to that copy', () => {
    const copy = 'ghcr.io/open-laboratory-data-repository/postgres:16-alpine';
    const text = `image: ${copy}@${D1}\nFROM ${copy}@${D1} AS x\n`;
    expect(replaceDigest(text, copy, D1, D2)).toBe(`image: ${copy}@${D2}\nFROM ${copy}@${D2} AS x\n`);
  });
});
