import { describe, it, expect } from 'vitest';
import { evaluatePreconditions, type ReleaseFacts } from './preconditions';

const clean: ReleaseFacts = {
  version: '0.2.0',
  lastTag: 'v0.1.0',
  treeClean: true,
  branch: 'main',
  syncedWithOrigin: true,
  gitTagExists: false,
  registryTagImages: [],
  changelogCommitted: true,
  gateGreen: true,
};

describe('evaluatePreconditions', () => {
  it('returns no refusals when everything is in order', () => {
    expect(evaluatePreconditions(clean)).toEqual([]);
  });

  it('refuses a dirty working tree', () => {
    const r = evaluatePreconditions({ ...clean, treeClean: false });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/working tree/i);
  });

  it('refuses a branch other than main', () => {
    expect(evaluatePreconditions({ ...clean, branch: 'feat/x' })[0]).toMatch(/main/);
  });

  it('refuses when local and origin have diverged', () => {
    expect(evaluatePreconditions({ ...clean, syncedWithOrigin: false })[0]).toMatch(/origin/i);
  });

  it('refuses when the version was not bumped past the last tag', () => {
    const r = evaluatePreconditions({ ...clean, version: '0.1.0', lastTag: 'v0.1.0' });
    expect(r[0]).toMatch(/0\.1\.0/);
    expect(r[0]).toMatch(/package\.json/);
  });

  it('refuses when the version went backwards', () => {
    expect(evaluatePreconditions({ ...clean, version: '0.0.9', lastTag: 'v0.1.0' })).toHaveLength(1);
  });

  it('allows the very first release, when no tag exists yet', () => {
    expect(evaluatePreconditions({ ...clean, lastTag: null })).toEqual([]);
  });

  it('refuses when the git tag already exists', () => {
    expect(evaluatePreconditions({ ...clean, gitTagExists: true })[0]).toMatch(/v0\.2\.0/);
  });

  // The overwrite guard — the reason this task exists.
  it('refuses when the version tag is already in the registry', () => {
    const r = evaluatePreconditions({ ...clean, registryTagImages: ['openldr-api'] });
    expect(r[0]).toMatch(/registry/i);
    expect(r[0]).toMatch(/0\.2\.0/);
  });

  // A half-finished previous run leaves the tag on some images and not others. The operator
  // cannot act on "the tag exists somewhere" — the refusal has to say which.
  it('names every image that already carries the tag', () => {
    const r = evaluatePreconditions({
      ...clean,
      registryTagImages: ['openldr-gateway', 'openldr-keycloak'],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/openldr-gateway/);
    expect(r[0]).toMatch(/openldr-keycloak/);
  });

  it('does not refuse when no image carries the tag', () => {
    expect(evaluatePreconditions({ ...clean, registryTagImages: [] })).toEqual([]);
  });

  it('refuses when the changelog was not regenerated', () => {
    expect(evaluatePreconditions({ ...clean, changelogCommitted: false })[0]).toMatch(/changelog/i);
  });

  it('refuses when the test gate is red', () => {
    expect(evaluatePreconditions({ ...clean, gateGreen: false })[0]).toMatch(/test/i);
  });

  it('reports every refusal at once, not just the first', () => {
    const r = evaluatePreconditions({ ...clean, treeClean: false, gateGreen: false, gitTagExists: true });
    expect(r).toHaveLength(3);
  });

  it('refuses a version string it cannot parse', () => {
    expect(evaluatePreconditions({ ...clean, version: 'latest' })[0]).toMatch(/latest/);
  });

  it('gives exactly one refusal for an unparseable version, not a misleading "bump it first" as well', () => {
    const r = evaluatePreconditions({ ...clean, version: 'latest', lastTag: 'v0.1.0' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/not a X\.Y\.Z version/);
  });
});
