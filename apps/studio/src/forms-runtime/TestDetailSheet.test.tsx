import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    expect(picker).toHaveTextContent('Female 18+');
    await user.click(picker);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Female 18+', 'Highland women', 'Male 15+']);
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

  it('warns when the picked range does not fit the patient, and allows it', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 14, unit: 'g/dL', band: MEN },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('This range is for Male 15+')).toBeInTheDocument();
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
});
