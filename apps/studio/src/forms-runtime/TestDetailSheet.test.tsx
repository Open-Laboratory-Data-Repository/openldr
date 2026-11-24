import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

vi.mock('@/api', () => ({ catalogSpecimensFor: vi.fn(), expandValueSetByUrl: vi.fn() }));
import { catalogSpecimensFor, expandValueSetByUrl } from '@/api';
import { TestDetailSheet } from './TestDetailSheet';

const test = { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC', display: 'Full blood count' };
const HIGHLAND = { name: 'Highland women', low: 13, high: 17, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null };
const LOWLAND = { name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null };
const MEN = { name: null, low: 13.5, high: 17.5, unit: 'g/dL', sex: 'male', ageLow: 15, ageHigh: null };
const numeric = {
  system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null,
  bands: [LOWLAND, HIGHLAND, MEN], fits: ['yes', 'yes', 'no'] as Array<'yes' | 'no' | 'unknown'>,
  unit: 'g/dL', display: 'Haemoglobin', band: LOWLAND,
};
const coded = {
  system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded' as const, valueSetUrl: 'urn:openldr:valueset:rdt',
  bands: [], fits: [], unit: null, display: 'Malaria RDT', band: null,
};
const text = {
  system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text' as const, valueSetUrl: null,
  bands: [], fits: [], unit: null, display: 'Note', band: null,
};
const sexes = [
  { code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } },
  { code: 'male', labels: { en: 'Male', fr: 'Homme', pt: 'Masculino' } },
];
const detail = { specimen: null, rejection: null, results: [] };

beforeEach(() => {
  vi.mocked(catalogSpecimensFor).mockReset();
  vi.mocked(expandValueSetByUrl).mockReset();
  vi.mocked(catalogSpecimensFor).mockResolvedValue([{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }]);
  vi.mocked(expandValueSetByUrl).mockResolvedValue([{ system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' }]);
});

describe('TestDetailSheet', () => {
  it('shows one input per result parameter, by type', async () => {
    render(<TestDetailSheet test={test} params={[numeric, coded, text]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.getByLabelText('Malaria RDT')).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toBeInTheDocument();
  });

  // Test identity spec, call 8: the sheet heads with the Test code. The coding keeps the id.
  it('shows the Test code it is given in place of the id', async () => {
    const byId = { ...test, code: 'tst-0123456789abcdef' };
    render(<TestDetailSheet test={byId} testCode="FBC" params={[]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('FBC')).toBeInTheDocument();
    expect(screen.queryByText('tst-0123456789abcdef')).toBeNull();
    await waitFor(() => expect(catalogSpecimensFor).toHaveBeenCalled());
    expect(JSON.stringify(vi.mocked(catalogSpecimensFor).mock.calls[0])).toContain('tst-0123456789abcdef');
  });

  // Each parameter used to be its own grid, so each label column took that label's width and the
  // inputs started at a different place on every row. Found on the live sheet 2026-09-16.
  it('puts every label in one column, so the inputs line up', async () => {
    render(<TestDetailSheet test={test} params={[numeric, coded, text]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    const grid = screen.getByText('Specimen type').parentElement;
    for (const name of ['Haemoglobin', 'Malaria RDT', 'Note']) {
      expect(screen.getByText(name, { selector: 'label' }).parentElement).toBe(grid);
    }
  });

  // The studio has no CSS reset, so a <p> keeps a 1em bottom margin and pushes the next row down.
  it('draws the range line without a paragraph margin', async () => {
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('12 to 15 g/dL')).toBeInTheDocument());
    expect(screen.getByText('12 to 15 g/dL').tagName).not.toBe('P');
  });

  it('shows the matched band as text, and the unit beside the input', async () => {
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('12 to 15 g/dL')).toBeInTheDocument());
    expect(screen.getByText('g/dL')).toBeInTheDocument();
  });

  // The sheet is controlled: it writes through onChange and renders what its `detail` prop says. This
  // test holds that prop still, so one keystroke is one write.
  it('writes the typed number with its unit and the band it was measured against', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} sexes={sexes} onChange={onChange} onClose={() => {}} />);
    await user.type(screen.getByLabelText('Haemoglobin'), '9');
    expect(onChange).toHaveBeenCalled();
    const written = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(written.results[0].value).toBe(9);
    expect(written.results[0].unit).toBe('g/dL');
    expect(written.results[0].band).toEqual(numeric.band);
  });

  // The input showed String(value) and parsed every keystroke, so "3." redrew as "3" and "3.5" was
  // saved as 35. This test lets `detail` follow onChange, as TestDetailsField does.
  it('keeps a decimal point while the bench types a result, one key at a time', async () => {
    const user = userEvent.setup();
    const writes: number[] = [];
    function Host() {
      const [current, setCurrent] = useState<typeof detail>(detail);
      return (
        <TestDetailSheet
          test={test} params={[numeric]} detail={current} sexes={sexes}
          onChange={(next) => { writes.push(next.results[0]?.value as number); setCurrent(next as typeof detail); }}
          onClose={() => {}}
        />
      );
    }
    render(<Host />);
    const input = await screen.findByLabelText('Haemoglobin');
    await user.type(input, '3.');
    expect(input).toHaveValue('3.');
    await user.type(input, '5');
    expect(input).toHaveValue('3.5');
    expect(writes[writes.length - 1]).toBe(3.5);
    expect(await screen.findByText('below 12')).toBeInTheDocument();
  });

  it('shows the flag for a value already outside the band', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: numeric.code }, resultType: 'numeric' as const, value: 11.2, unit: 'g/dL', band: numeric.band },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/below 12/i)).toBeInTheDocument());
  });

  it('shows no flag for a value inside the band', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: numeric.code }, resultType: 'numeric' as const, value: 13, unit: 'g/dL', band: numeric.band },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.queryByText(/below|above/i)).toBeNull();
  });

  it('shows no range line when no band matched', async () => {
    render(<TestDetailSheet test={test} params={[{ ...numeric, band: null }]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.queryByText(/to 15 g\/dL/)).toBeNull();
  });

  it('offers only the specimens the chosen test accepts', async () => {
    render(<TestDetailSheet test={test} params={[]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(catalogSpecimensFor).toHaveBeenCalledWith([{ system: test.system, code: test.code }]));
  });

  it('asks for a coded parameter options by the url the server gave', async () => {
    render(<TestDetailSheet test={test} params={[coded]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(expandValueSetByUrl).toHaveBeenCalledWith('urn:openldr:valueset:rdt'));
  });

  it('starts the range picker on the range the server matched, and lists every range by name or label', async () => {
    const user = userEvent.setup();
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: /range haemoglobin/i });
    expect(picker).toHaveTextContent('Female 18+ years');
    await user.click(picker);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Female 18+ years', 'Highland women', 'Male 15+ years']);
  });

  it('writes the picked range, name included, and flags the value against it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL', band: LOWLAND },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={onChange} onClose={() => {}} />);
    await user.click(await screen.findByRole('combobox', { name: /range haemoglobin/i }));
    await user.click(await screen.findByRole('option', { name: 'Highland women' }));
    const written = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(written.results[0].band).toEqual(HIGHLAND);
    expect(written.results[0].value).toBe(12.5);
  });

  it('flags against the range already picked, not the one the server matched', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL', band: HIGHLAND },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('below 13')).toBeInTheDocument();
    expect(screen.getByText('13 to 17 g/dL')).toBeInTheDocument();
  });

  // Fix 2 of the named-reference-ranges review: a result typed while no range matched is saved with
  // no band. If params then reload with a non-null param.band (the patient changed), the old code
  // fell back to param.band and showed a range the saved answer does not hold.
  it('shows no range picked for a result with no band, even when the server now matches one', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL' },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: /range haemoglobin/i });
    expect(picker).toHaveTextContent('Choose a range');
    expect(screen.queryByText('12 to 15 g/dL')).toBeNull();
    expect(screen.queryByText(/below|above|this range is for/i)).toBeNull();
  });

  // A saved band that differs from the catalog's only in its critical limits is not that band.
  it('shows no range picked when the saved band differs from every range only in its critical limits', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL',
        band: { ...LOWLAND, criticalLow: 7 } },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: /range haemoglobin/i });
    expect(picker).toHaveTextContent('Choose a range');
    expect(screen.queryByText('12 to 15 g/dL')).toBeNull();
  });

  it('treats an absent critical limit and a null one as the same band', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL',
        band: { ...LOWLAND, criticalLow: null, criticalHigh: null } },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: /range haemoglobin/i });
    expect(picker).toHaveTextContent('Female 18+ years');
  });

  it('tells a range in days from the same numbers in years, and labels it by its unit', async () => {
    const user = userEvent.setup();
    const DAYS = { name: null, low: 14, high: 22, unit: 'g/dL', sex: null, ageLow: 0, ageHigh: 28, ageUnit: 'd' as const };
    const YEARS = { ...DAYS, ageUnit: undefined };
    const both = { ...numeric, bands: [YEARS, DAYS], fits: ['no', 'yes'] as Array<'yes' | 'no' | 'unknown'>, band: DAYS };
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 18, unit: 'g/dL', band: DAYS },
    ] };
    render(<TestDetailSheet test={test} params={[both]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: /range haemoglobin/i });
    expect(picker).toHaveTextContent('0 to 28 days');
    await user.click(picker);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['0 to 28 years', '0 to 28 days']);
  });

  it('warns when the picked range does not fit the patient, and allows it', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 14, unit: 'g/dL', band: MEN },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('This range is for Male 15+ years')).toBeInTheDocument();
    expect(screen.getByLabelText('Haemoglobin')).toHaveValue('14');
  });

  it('stays quiet about a range whose fit is unknown', async () => {
    const unknown = { ...numeric, fits: ['unknown', 'unknown', 'unknown'] as Array<'yes' | 'no' | 'unknown'>, band: null };
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 14, unit: 'g/dL', band: MEN },
    ] };
    render(<TestDetailSheet test={test} params={[unknown]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await screen.findByLabelText('Haemoglobin');
    expect(screen.queryByText(/this range is for/i)).toBeNull();
  });

  it('takes its range words from the caller', async () => {
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} sexes={sexes} copy={{ language: 'fr', range: 'Intervalle', ageFrom: 'dès {from} ans' }} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByRole('combobox', { name: /intervalle haemoglobin/i })).toHaveTextContent('Femme dès 18 ans');
  });

  // Plan B, Task 3: yes/no, date and several-answer fields, and the field settings (call 5: shown, never refused).
  describe('new types and field settings', () => {
    const P = 'urn:openldr:default_result';
    const growth = { system: P, code: 'GROWTH', resultType: 'boolean' as const, valueSetUrl: null, bands: [], fits: [], unit: null, display: 'Growth', band: null };
    const collected = { system: P, code: 'COLLECTED', resultType: 'date' as const, valueSetUrl: null, bands: [], fits: [], unit: null, display: 'Collected on', band: null, dateLimit: 'past' as const };
    const markers = { system: P, code: 'MARKERS', resultType: 'multicoded' as const, valueSetUrl: 'urn:openldr:valueset:markers', bands: [], fits: [], unit: null, display: 'Markers', band: null };
    const ESBL = { system: 'urn:openldr:cs:local', code: 'ESBL', display: 'ESBL' };
    const CARB = { system: 'urn:openldr:cs:local', code: 'CARB', display: 'Carbapenemase' };
    const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0];

    it('writes a yes/no field from a switch as true, then false', async () => {
      const user = userEvent.setup();
      const writes: unknown[] = [];
      function Host() {
        const [current, setCurrent] = useState<typeof detail>(detail);
        return <TestDetailSheet test={test} params={[growth]} detail={current} sexes={sexes}
          onChange={(next) => { writes.push(next.results[0]?.value); setCurrent(next as typeof detail); }} onClose={() => {}} />;
      }
      render(<Host />);
      const toggle = await screen.findByRole('switch', { name: 'Growth' });
      expect(screen.getByText('Not answered')).toBeInTheDocument();
      await user.click(toggle);
      expect(screen.getByText('Yes')).toBeInTheDocument();
      await user.click(toggle);
      expect(writes).toEqual([true, false]);
      expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('shows a saved date in the date picker, and the date limit without refusing', async () => {
      const typed = { specimen: null, rejection: null, results: [
        { param: { system: P, code: 'COLLECTED' }, resultType: 'date' as const, value: '2026-11-20' },
      ] };
      render(<TestDetailSheet test={test} params={[collected]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
      expect(await screen.findByLabelText('Collected on')).toHaveTextContent('20/11/2026');
      expect(screen.getByText('Past dates only')).toBeInTheDocument();
    });

    it('writes each chosen answer of a several-answer field, from the value set the server named', async () => {
      vi.mocked(expandValueSetByUrl).mockResolvedValue([ESBL, CARB]);
      const user = userEvent.setup();
      const onChange = vi.fn();
      const typed = { specimen: null, rejection: null, results: [
        { param: { system: P, code: 'MARKERS' }, resultType: 'multicoded' as const, value: [ESBL] },
      ] };
      render(<TestDetailSheet test={test} params={[markers]} detail={typed} sexes={sexes} onChange={onChange} onClose={() => {}} />);
      await waitFor(() => expect(expandValueSetByUrl).toHaveBeenCalledWith('urn:openldr:valueset:markers'));
      expect(await screen.findByText('ESBL')).toBeInTheDocument();
      await user.click(screen.getByLabelText('Markers'));
      await user.click(await screen.findByRole('option', { name: 'Carbapenemase' }));
      expect(last(onChange).results[0]).toMatchObject({ resultType: 'multicoded', value: [ESBL, CARB] });
    });

    it('writes no value once the last chosen answer is removed', async () => {
      vi.mocked(expandValueSetByUrl).mockResolvedValue([ESBL]);
      const user = userEvent.setup();
      const onChange = vi.fn();
      const typed = { specimen: null, rejection: null, results: [
        { param: { system: P, code: 'MARKERS' }, resultType: 'multicoded' as const, value: [ESBL] },
      ] };
      render(<TestDetailSheet test={test} params={[markers]} detail={typed} sexes={sexes} onChange={onChange} onClose={() => {}} />);
      await user.click(await screen.findByRole('button', { name: 'Remove ESBL' }));
      expect(last(onChange).results[0].value).toBeNull();
    });

    it('marks an optional field, and nothing on a field saved before field settings', async () => {
      render(<TestDetailSheet test={test} params={[numeric, { ...text, required: false }]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
      await screen.findByLabelText('Haemoglobin');
      expect(screen.getAllByText('Optional')).toHaveLength(1);
      expect(screen.getByLabelText('Note').parentElement).toHaveTextContent('Optional');
    });

    it('shows the number and length limits, and still writes a value outside them', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const limited = { ...numeric, bands: [], fits: [], band: null, min: 0, max: 5, decimals: 1 };
      const short = { ...text, minLength: 2, maxLength: 10 };
      render(<TestDetailSheet test={test} params={[limited, short]} detail={detail} sexes={sexes} onChange={onChange} onClose={() => {}} />);
      expect(await screen.findByText('Allowed 0 to 5, decimal places: 1')).toBeInTheDocument();
      expect(screen.getByText('2 to 10 characters')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Haemoglobin'), '9');
      expect(last(onChange).results[0].value).toBe(9);
    });

    // Review focus 2: an absent pregnancy and "any" are the same band, and dates and country never
    // decide which band was picked, as in findCatalogBand.
    it('finds the picked range whatever its pregnancy any, dates or country say', async () => {
      const typed = { specimen: null, rejection: null, results: [
        { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL',
          band: { ...LOWLAND, pregnancy: 'any', validTo: '2020-12-31', country: 'KEN' } },
      ] };
      render(<TestDetailSheet test={test} params={[numeric]} detail={typed as never} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
      const picker = await screen.findByRole('combobox', { name: /range haemoglobin/i });
      expect(picker).toHaveTextContent('Female 18+ years');
    });

    it('tells a range from one that differs only in its source', async () => {
      const typed = { specimen: null, rejection: null, results: [
        { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL', band: { ...LOWLAND, source: 'WHO' as const } },
      ] };
      render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
      expect(await screen.findByRole('combobox', { name: /range haemoglobin/i })).toHaveTextContent('Choose a range');
    });
  });
});
