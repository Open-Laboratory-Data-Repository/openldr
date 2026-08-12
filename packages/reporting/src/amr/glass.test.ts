import { describe, it, expect } from 'vitest';
import { toGlassRis, GLASS_SUBMISSION_COLUMNS, type GlassRisRow } from './glass';
import type { Isolate } from './types';

const iso: Isolate = {
  patientId: 'p1', specimenType: 'BLOOD', origin: 'inpatient', pathogenCode: 'eco', pathogenName: 'E. coli',
  date: '2026-01-10', gender: 'female', ageBand: '25-34', results: [{ antibiotic: 'AMP', ris: 'R' }, { antibiotic: 'CIP', ris: 'S' }],
};

describe('toGlassRis', () => {
  it('emits one stratified row per pathogen/antibiotic/strata with counts + meta', () => {
    const rows = toGlassRis([iso], { country: 'SLE', year: 2026 });
    const amp = rows.find((r) => r.AntibioticCode === 'AMP')!;
    expect(amp).toMatchObject({ Iso3Country: 'SLE', Year: 2026, Specimen: 'BLOOD', PathogenCode: 'eco', Gender: 'female', AgeGroup: '25-34', Origin: 'inpatient', Resistant: 1, Intermediate: 0, Susceptible: 0, Total: 1 });
  });
});

describe('GLASS_SUBMISSION_COLUMNS', () => {
  // ⛔ This list is a WIRE CONTRACT: it is the header and column order of a file submitted to a
  // national programme. The query projects MORE than this (display names for the PDF, added in a
  // later task), and toCsv(result.columns, ...) would otherwise put them in the submission.
  // Changing this array changes what a ministry receives.
  it('is exactly the twelve GLASS RIS columns, in order, key === label', () => {
    expect(GLASS_SUBMISSION_COLUMNS.map((c) => c.key)).toEqual([
      'Iso3Country', 'Year', 'Specimen', 'PathogenCode', 'AntibioticCode',
      'Gender', 'AgeGroup', 'Origin', 'Resistant', 'Intermediate', 'Susceptible', 'Total',
    ]);
    for (const c of GLASS_SUBMISSION_COLUMNS) expect(c.label).toBe(c.key);
  });

  it('matches the GlassRisRow keys, so the type and the wire cannot drift', () => {
    const row: GlassRisRow = {
      Iso3Country: 'ZMB', Year: 2026, Specimen: 'blood', PathogenCode: 'ECOLI',
      AntibioticCode: 'Ciprofloxacin', Gender: 'male', AgeGroup: '25-34', Origin: 'inpatient',
      Resistant: 1, Intermediate: 0, Susceptible: 0, Total: 1,
    };
    expect(GLASS_SUBMISSION_COLUMNS.map((c) => c.key)).toEqual(Object.keys(row));
  });
});
