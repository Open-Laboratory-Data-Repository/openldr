import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import { capabilityLine } from './util';

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
    const kinds = ['read-input', 'emit-fhir', 'net-egress', 'data-scope', 'host:reports', 'host:connectors', 'host:schedule', 'host:fhir', 'host:import'];
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
