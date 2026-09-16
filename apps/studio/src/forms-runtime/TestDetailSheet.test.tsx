import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api', () => ({ catalogSpecimensFor: vi.fn(), expandValueSetByUrl: vi.fn() }));
import { catalogSpecimensFor, expandValueSetByUrl } from '@/api';
import { TestDetailSheet } from './TestDetailSheet';

const test = { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC', display: 'Full blood count' };
const numeric = {
  system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null, bands: [],
  unit: 'g/dL', display: 'Haemoglobin',
  band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
};
const coded = {
  system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded' as const, valueSetUrl: 'urn:openldr:valueset:rdt',
  bands: [], unit: null, display: 'Malaria RDT', band: null,
};
const text = {
  system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text' as const, valueSetUrl: null,
  bands: [], unit: null, display: 'Note', band: null,
};
const detail = { specimen: null, rejection: null, results: [] };

beforeEach(() => {
  vi.mocked(catalogSpecimensFor).mockReset();
  vi.mocked(expandValueSetByUrl).mockReset();
  vi.mocked(catalogSpecimensFor).mockResolvedValue([{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }]);
  vi.mocked(expandValueSetByUrl).mockResolvedValue([{ system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' }]);
});

describe('TestDetailSheet', () => {
  it('shows one input per result parameter, by type', async () => {
    render(<TestDetailSheet test={test} params={[numeric, coded, text]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.getByLabelText('Malaria RDT')).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toBeInTheDocument();
  });

  it('shows the matched band as text, and the unit beside the input', async () => {
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('12 to 15 g/dL')).toBeInTheDocument());
    expect(screen.getByText('g/dL')).toBeInTheDocument();
  });

  // The sheet is controlled: it writes through onChange and renders what its `detail` prop says. This
  // test holds that prop still, so one keystroke is one write.
  it('writes the typed number with its unit and the band it was measured against', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} onChange={onChange} onClose={() => {}} />);
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
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/below 12/i)).toBeInTheDocument());
  });

  it('shows no flag for a value inside the band', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: numeric.code }, resultType: 'numeric' as const, value: 13, unit: 'g/dL', band: numeric.band },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.queryByText(/below|above/i)).toBeNull();
  });

  it('shows no range line when no band matched', async () => {
    render(<TestDetailSheet test={test} params={[{ ...numeric, band: null }]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.queryByText(/to 15 g\/dL/)).toBeNull();
  });

  it('offers only the specimens the chosen test accepts', async () => {
    render(<TestDetailSheet test={test} params={[]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(catalogSpecimensFor).toHaveBeenCalledWith([{ system: test.system, code: test.code }]));
  });

  it('asks for a coded parameter options by the url the server gave', async () => {
    render(<TestDetailSheet test={test} params={[coded]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(expandValueSetByUrl).toHaveBeenCalledWith('urn:openldr:valueset:rdt'));
  });
});
