import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoincHints, ResultFieldsFromLoincAnswer } from '@openldr/bootstrap';

const loincHints = { hints: vi.fn(), resultFieldsFromLoinc: vi.fn() };
const audit: unknown[] = [];
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return {
    ...actual,
    createAppContext: async () => ({ loincHints, close: async () => {} }),
    recordAuditEvent: async (_ctx: unknown, _actor: unknown, e: unknown) => { audit.push(e); },
  };
});

import { runLoincHints, runResultFieldsFromLoinc } from './loinc-hints';

const HINTS: LoincHints = {
  code: '6429-5', display: 'HIV culture of Blood', class: 'MICRO', categorySuggestion: { code: 'MICRO', display: 'Microbiology' },
  unit: null, resultType: 'text',
  specimens: [
    { snomed: '119297000', display: 'Blood specimen', equivalence: 'equivalent', specimenType: { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }, tick: true },
    { snomed: '122555007', display: null, equivalence: 'narrower', specimenType: null, tick: false },
  ],
  answers: [], panelMembers: [],
};

const FROM_PANEL: ResultFieldsFromLoincAnswer = {
  params: [
    { system: 'urn:openldr:default_result', code: '2093-3', resultType: 'numeric', valueSetUrl: null, bands: [] },
    { system: 'urn:openldr:default_result', code: '2571-8', resultType: 'numeric', valueSetUrl: null, bands: [] },
  ],
  created: ['2571-8'], reused: ['2093-3'], valueSetsCreated: [],
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  return { out: () => out.join(''), err: () => err.join('') };
}

beforeEach(() => { vi.restoreAllMocks(); audit.length = 0; loincHints.hints.mockReset(); loincHints.resultFieldsFromLoinc.mockReset(); });

describe('openldr test-catalog loinc-hints', () => {
  it('prints the class, category, result type and each specimen with its match', async () => {
    loincHints.hints.mockResolvedValue(HINTS);
    const io = capture();
    expect(await runLoincHints('6429-5', { json: false })).toBe(0);
    expect(io.out()).toBe([
      '6429-5  HIV culture of Blood',
      'class: MICRO (category MICRO)',
      'result: text',
      'specimen: SNOMED 119297000 Blood specimen (equivalent), specimen type BLD, ticked',
      'specimen: SNOMED 122555007 (narrower), no specimen type matches',
    ].join('\n') + '\n');
  });

  it('says how to load LOINC when there are no hints, and --json prints null', async () => {
    loincHints.hints.mockResolvedValue(null);
    const io = capture();
    expect(await runLoincHints('6429-5', { json: false })).toBe(0);
    expect(io.out()).toContain('openldr terminology import loinc');
    expect(await runLoincHints('6429-5', { json: true })).toBe(0);
    expect(io.out()).toContain('null\n');
  });

  it('fails with the service\'s words', async () => {
    loincHints.hints.mockRejectedValue(new Error('LOINC code 9999-9 is not in the LOINC loaded on this install.'));
    const io = capture();
    expect(await runLoincHints('9999-9', { json: false })).toBe(1);
    expect(io.err()).toContain('test-catalog loinc-hints failed: LOINC code 9999-9 is not in the LOINC loaded');
  });
});

describe('openldr test-catalog result-fields from-loinc', () => {
  it('passes the codes and --panel, prints each field, and audits as the CLI actor', async () => {
    loincHints.resultFieldsFromLoinc.mockResolvedValue(FROM_PANEL);
    const io = capture();
    expect(await runResultFieldsFromLoinc(['24331-1'], { panel: true, json: false })).toBe(0);
    expect(loincHints.resultFieldsFromLoinc).toHaveBeenCalledWith(['24331-1'], { panel: true });
    expect(io.out()).toBe([
      '2093-3  numeric  already there',
      '2571-8  numeric  made',
      'made 1 field(s) and 0 answer set(s), used 1 already there',
    ].join('\n') + '\n');
    expect(audit).toEqual([expect.objectContaining({ action: 'result_field.from_loinc', entityId: '24331-1', after: { created: ['2571-8'], valueSetsCreated: [] } })]);
  });

  it('--json prints the answer, and a refusal is not audited', async () => {
    loincHints.resultFieldsFromLoinc.mockResolvedValue(FROM_PANEL);
    const io = capture();
    expect(await runResultFieldsFromLoinc(['24331-1'], { panel: true, json: true })).toBe(0);
    expect(JSON.parse(io.out())).toEqual(FROM_PANEL);
    audit.length = 0;
    loincHints.resultFieldsFromLoinc.mockRejectedValue(new Error('LOINC code 2093-3 is not a panel, so it has no member tests.'));
    expect(await runResultFieldsFromLoinc(['2093-3'], { panel: true, json: false })).toBe(1);
    expect(audit).toEqual([]);
  });
});
