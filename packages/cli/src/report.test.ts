import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  appCtx: {
    reporting: {
      run: vi.fn(),
      renderPdf: vi.fn(),
    },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
}));

import { runReportGlassExport } from './report';

// This is the CLI's half of the GLASS submission wire contract — the twin of the route test in
// apps/server/src/reports-routes.test.ts. `openldr report glass-export` is the path that actually
// writes the file an operator hands to a ministry, so it needs the same guarantee: the query behind
// `r-amr-glass-ris` deliberately projects more columns than the submission carries (display names
// like `Pathogen`/`SpecimenName` feed the human-facing PDF), and `runReportGlassExport` must still
// emit only the twelve pinned `GLASS_SUBMISSION_COLUMNS`. If it ever drifts back to
// `toCsv(result.columns, result.rows)`, those names silently land in a national submission.
describe('runReportGlassExport — submission column pin', () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(join(tmpdir(), 'glass-export-'));
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.reporting.run.mockResolvedValue({
      columns: [
        { key: 'Iso3Country', label: 'Iso3Country' }, { key: 'Year', label: 'Year' },
        { key: 'Specimen', label: 'Specimen' }, { key: 'SpecimenName', label: 'Specimen name' },
        { key: 'PathogenCode', label: 'PathogenCode' }, { key: 'Pathogen', label: 'Pathogen' },
        { key: 'AntibioticCode', label: 'AntibioticCode' }, { key: 'Gender', label: 'Gender' },
        { key: 'AgeGroup', label: 'AgeGroup' }, { key: 'Origin', label: 'Origin' },
        { key: 'Resistant', label: 'Resistant' }, { key: 'Intermediate', label: 'Intermediate' },
        { key: 'Susceptible', label: 'Susceptible' }, { key: 'Total', label: 'Total' },
      ],
      rows: [{
        Iso3Country: 'ZMB', Year: 2026, Specimen: 'BLD', SpecimenName: 'Blood',
        PathogenCode: 'ECOLI', Pathogen: 'Escherichia coli', AntibioticCode: 'Ciprofloxacin',
        Gender: 'male', AgeGroup: '25-34', Origin: 'inpatient',
        Resistant: 1, Intermediate: 0, Susceptible: 0, Total: 1,
      }],
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes only the pinned twelve columns even though the query returns more', async () => {
    const out = join(dir, 'glass-ris.csv');
    const code = await runReportGlassExport({ country: 'ZM', year: '2026', out, json: false });

    expect(code).toBe(0);
    const csv = await readFile(out, 'utf8');
    const [header, first] = csv.trim().split('\n');

    expect(header).toBe(
      'Iso3Country,Year,Specimen,PathogenCode,AntibioticCode,Gender,AgeGroup,Origin,Resistant,Intermediate,Susceptible,Total',
    );
    expect(header).not.toContain('SpecimenName');
    expect(header).not.toContain('Pathogen,');
    expect(first).toBe('ZMB,2026,BLD,ECOLI,Ciprofloxacin,male,25-34,inpatient,1,0,0,1');
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });

  it('--json also carries only the pinned twelve columns, in order', async () => {
    let stdout = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += chunk;
      return true;
    });

    try {
      const code = await runReportGlassExport({ country: 'ZM', year: '2026', json: true });
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }

    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed[0])).toEqual([
      'Iso3Country', 'Year', 'Specimen', 'PathogenCode', 'AntibioticCode', 'Gender',
      'AgeGroup', 'Origin', 'Resistant', 'Intermediate', 'Susceptible', 'Total',
    ]);
    expect(parsed[0]).not.toHaveProperty('SpecimenName');
    expect(parsed[0]).not.toHaveProperty('Pathogen');
  });
});

// `openldr report run --format pdf --lang fr` is the headless half of the studio's print-language
// switcher. `lang` is a RESERVED run key the server splits off (`splitLang` in @openldr/bootstrap),
// so the CLI's whole job is to put it in the params map — and to let an explicit --param win, which
// is the only way to feed a design that declares its own `lang` parameter.
describe('runReportRun — print language', () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(join(tmpdir(), 'report-lang-'));
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.reporting.renderPdf.mockResolvedValue(Buffer.from('%PDF-1.4'));
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('sends --lang as the reserved `lang` run key', async () => {
    const { runReportRun } = await import('./report');
    const out = join(dir, 'r.pdf');
    expect(await runReportRun('r1', { json: false, csv: false, format: 'pdf', out, lang: 'fr' })).toBe(0);
    expect(mocks.appCtx.reporting.renderPdf).toHaveBeenCalledWith('r1', { lang: 'fr' });
    expect((await readFile(out)).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('omits `lang` entirely without the flag, so the authored text prints', async () => {
    const { runReportRun } = await import('./report');
    await runReportRun('r1', { json: false, csv: false, format: 'pdf', out: join(dir, 'r.pdf'), param: ['from=2026-01-01'] });
    expect(mocks.appCtx.reporting.renderPdf).toHaveBeenCalledWith('r1', { from: '2026-01-01' });
  });

  it('an explicit --param lang=... beats --lang', async () => {
    const { runReportRun } = await import('./report');
    await runReportRun('r1', { json: false, csv: false, format: 'pdf', out: join(dir, 'r.pdf'), lang: 'fr', param: ['lang=sw-code'] });
    expect(mocks.appCtx.reporting.renderPdf).toHaveBeenCalledWith('r1', { lang: 'sw-code' });
  });
});
