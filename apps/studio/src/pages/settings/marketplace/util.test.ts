import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import type { AvailableArtifact, InstalledArtifact } from '@/api';
import { availableToEntry, capabilityLine, newerAvailable, pluginPermissionLines } from './util';

describe('capabilityLine', () => {
  const t = i18n.getFixedT('en');

  it('names each capability in plain words, with its code kept for reference', () => {
    expect(capabilityLine({ kind: 'host:reports' }, t)).toBe('Read and run reports (host:reports)');
    expect(capabilityLine({ kind: 'host:fhir' }, t)).toBe('Read the facility list (host:fhir)');
    expect(capabilityLine({ kind: 'emit-fhir', resourceTypes: ['Patient', 'Observation'] }, t)).toBe('Save these records: Patient, Observation (emit-fhir)');
    expect(capabilityLine({ kind: 'net-egress', allowedHosts: ['play.dhis2.org'] }, t)).toBe('Connect to these servers: play.dhis2.org (net-egress)');
    expect(capabilityLine({ kind: 'net-egress', allowedHosts: [] }, t)).toBe('Connect to these servers: none (net-egress)');
  });

  it('every capability the marketplace knows has a plain name in en, fr and pt', () => {
    const kinds = ['read-input', 'emit-fhir', 'net-egress', 'data-scope', 'host:reports', 'host:connectors', 'host:schedule', 'host:fhir', 'host:import', 'host:db', 'host:ce-read'];
    for (const lng of ['en', 'fr', 'pt']) {
      const tl = i18n.getFixedT(lng);
      for (const kind of kinds) {
        const line = capabilityLine({ kind, resourceTypes: ['Patient'], allowedHosts: ['h'], formats: ['csv'] }, tl);
        expect(line, `${lng} ${kind}`).not.toMatch(/^settings\.|\{\{/);
        expect(line.startsWith(kind), `${lng} ${kind}`).toBe(false);
      }
    }
  });

  it('an unknown capability falls back to its code', () => {
    expect(capabilityLine({ kind: 'host:future' }, t)).toBe('host:future');
    expect(capabilityLine('odd', t)).toBe('odd');
  });

  it('French reads in French', () => {
    expect(capabilityLine({ kind: 'host:reports' }, i18n.getFixedT('fr'))).toBe('Lire et exécuter des rapports (host:reports)');
  });
});

describe('newerAvailable', () => {
  const avail = (version: string, ref = `reg:cdr-source-${version}`): AvailableArtifact =>
    ({ ref, id: 'cdr-source', version, type: 'plugin', publisher: null }) as AvailableArtifact;

  it('offers the Marketplace version when it is newer than the active one', () => {
    expect(newerAvailable('cdr-source', '0.1.4', [avail('0.1.5')], ['0.1.4']))
      .toEqual({ version: '0.1.5', ref: 'reg:cdr-source-0.1.5', rolledBack: false });
  });

  it('offers nothing when the active version is the newest', () => {
    expect(newerAvailable('cdr-source', '0.1.5', [avail('0.1.5')], ['0.1.5'])).toBeNull();
    expect(newerAvailable('cdr-source', '0.1.5', [avail('0.1.4')], ['0.1.5'])).toBeNull();
    expect(newerAvailable('other', '0.1.0', [avail('0.1.5')], ['0.1.0'])).toBeNull();
  });

  // Found 2026-11-26: Update was offered for a version this CE cannot run. The consent sheet opened,
  // and only then did the install refuse it.
  it('offers no version this CE cannot run', () => {
    const cannot = { ...avail('0.2.0'), compatible: false, compatibility: { ceVersion: '>=9.0.0' } };
    expect(newerAvailable('cdr-source', '0.1.4', [cannot], ['0.1.4'])).toBeNull();
    expect(newerAvailable('cdr-source', '0.1.4', [cannot, avail('0.1.5')], ['0.1.4']))
      .toEqual({ version: '0.1.5', ref: 'reg:cdr-source-0.1.5', rolledBack: false });
  });

  it('marks a rollback: a newer version is installed but an older one is active', () => {
    expect(newerAvailable('cdr-source', '0.1.4', [avail('0.1.5')], ['0.1.4', '0.1.5']))
      .toEqual({ version: '0.1.5', ref: 'reg:cdr-source-0.1.5', rolledBack: true });
  });

  it('compares versions by their numbers, not as text', () => {
    expect(newerAvailable('cdr-source', '0.1.9', [avail('0.1.10')], ['0.1.9'])?.version).toBe('0.1.10');
  });
});

describe('pluginPermissionLines', () => {
  const payload = {
    kind: 'plugin',
    permissions: [
      { key: 'whonet.review', label: 'Review isolates', description: 'See and correct held isolates.', labels: { fr: { label: 'Revoir les isolats', description: 'Voir et corriger les isolats retenus.' } } },
      { key: 'whonet.export', label: 'Export', description: 'Download the WHONET file.' },
    ],
    actionPermissions: { review: ['whonet.review'], correct: ['whonet.review', 'forms.edit'] },
  };

  it('lists each declared permission with the actions that need it', () => {
    expect(pluginPermissionLines(payload, 'en', i18n.getFixedT('en')).slice(0, 2)).toEqual([
      'Review isolates (whonet.review): See and correct held isolates. Needed to run: review, correct.',
      'Export (whonet.export): Download the WHONET file.',
    ]);
  });
  it('uses the French label when given, and English when not', () => {
    const lines = pluginPermissionLines(payload, 'fr', i18n.getFixedT('fr'));
    expect(lines[0]).toBe('Revoir les isolats (whonet.review) : Voir et corriger les isolats retenus. Nécessaire pour exécuter : review, correct.');
    expect(lines[1]).toBe('Export (whonet.export) : Download the WHONET file.');
  });
  it('reads in every language with no missing key', () => {
    for (const lng of ['en', 'fr', 'pt']) {
      for (const line of pluginPermissionLines(payload, lng, i18n.getFixedT(lng))) {
        expect(line, lng).not.toMatch(/settings\.|\{\{/);
      }
    }
  });
  it('lists an action that needs only CE capabilities, by their translated label', () => {
    const p = { kind: 'plugin', actionPermissions: { publish: ['forms.edit', 'reports.view'], sync: ['some.unknown'] } };
    expect(pluginPermissionLines(p, 'en', i18n.getFixedT('en'))).toEqual([
      'Action publish needs: Edit forms or View reports.',
      'Action sync needs: some.unknown.',
    ]);
  });
  it('names a CE capability on an action that also lists a plugin key', () => {
    // correct: ['whonet.review', 'forms.edit'] means anyone with Edit forms can run correct.
    const lines = pluginPermissionLines(payload, 'en', i18n.getFixedT('en'));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('Action correct can also be run by anyone with: Edit forms.');
    for (const lng of ['fr', 'pt']) {
      const l = pluginPermissionLines(payload, lng, i18n.getFixedT(lng))[2];
      expect(l, lng).toContain('correct');
      expect(l, lng).not.toMatch(/settings\.|roles\.|\{\{|forms\.edit|anyone/);
    }
  });
  it('the CE-only action line exists in fr and pt', () => {
    const p = { kind: 'plugin', actionPermissions: { publish: ['forms.edit'] } };
    for (const lng of ['fr', 'pt']) {
      const [line] = pluginPermissionLines(p, lng, i18n.getFixedT(lng));
      expect(line, lng).toContain('publish');
      expect(line, lng).not.toMatch(/settings\.|roles\.|\{\{|forms\.edit|needs/);
    }
  });
  it('a payload without permissions gives no lines', () => {
    expect(pluginPermissionLines({ kind: 'plugin' }, 'en', i18n.getFixedT('en'))).toEqual([]);
    expect(pluginPermissionLines(null, 'en', i18n.getFixedT('en'))).toEqual([]);
  });
});

describe('availableToEntry', () => {
  const b = { ref: 'r', id: 'lab-bench', version: '0.6.2', type: 'plugin', publisher: null } as AvailableArtifact;
  it('names the CE range only when the list says this CE cannot run the bundle', () => {
    expect(availableToEntry({ ...b, compatible: false, compatibility: { ceVersion: '>=0.1.13' } }, new Map()).needsCe).toBe('>=0.1.13');
    expect(availableToEntry({ ...b, compatible: true, compatibility: { ceVersion: '*' } }, new Map()).needsCe).toBeUndefined();
    expect(availableToEntry(b, new Map()).needsCe).toBeUndefined();
  });

  // The dev stack, 2026-11-26: lab-bench 0.6.6 active and 0.6.5 installed from a local test registry,
  // and the public registry offering 0.6.2. The public card said Active.
  const row = (version: string, active: boolean) => ({ id: 'lab-bench', version, active, enabled: true, approvedBy: null, type: 'plugin', publisher: null, capabilities: [], legacy: false }) as InstalledArtifact;
  const rows = [row('0.6.6', true), row('0.6.5', false)];
  const byId = new Map([['lab-bench', rows[0]]]);

  it('marks a card Active only when its own version is the active one', () => {
    expect(availableToEntry({ ...b, version: '0.6.6' }, byId, rows)).toMatchObject({ installed: true, active: true });
    expect(availableToEntry({ ...b, version: '0.6.6' }, byId, rows).activeVersion).toBeUndefined();
  });

  it('a card for an installed but inactive version is installed, not active', () => {
    expect(availableToEntry({ ...b, version: '0.6.5' }, byId, rows)).toMatchObject({ installed: true, active: false });
    expect(availableToEntry({ ...b, version: '0.6.5' }, byId, rows).activeVersion).toBeUndefined();
  });

  it('a card for a version that is not installed names the active version instead', () => {
    expect(availableToEntry(b, byId, rows)).toMatchObject({ installed: true, active: false, activeVersion: '0.6.6' });
  });

  it('a plugin that is not installed has no installed state at all', () => {
    expect(availableToEntry(b, new Map(), [])).toMatchObject({ installed: false, active: false });
    expect(availableToEntry(b, new Map(), []).activeVersion).toBeUndefined();
  });
});
