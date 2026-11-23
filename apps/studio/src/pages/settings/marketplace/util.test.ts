import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import type { AvailableArtifact } from '@/api';
import { capabilityLine, newerAvailable } from './util';

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

  it('marks a rollback: a newer version is installed but an older one is active', () => {
    expect(newerAvailable('cdr-source', '0.1.4', [avail('0.1.5')], ['0.1.4', '0.1.5']))
      .toEqual({ version: '0.1.5', ref: 'reg:cdr-source-0.1.5', rolledBack: true });
  });

  it('compares versions by their numbers, not as text', () => {
    expect(newerAvailable('cdr-source', '0.1.9', [avail('0.1.10')], ['0.1.9'])?.version).toBe('0.1.10');
  });
});
