import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { ReportParametersBar } from './ReportParametersBar';
import type { ReportSummary } from '../api';

const report: ReportSummary = {
  id: 'amr-resistance', name: 'AMR', description: '', category: 'amr',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
};

describe('ReportParametersBar', () => {
  it('renders a Run button that fires onRun', () => {
    const onRun = vi.fn();
    render(
      <ReportParametersBar
        report={report} params={{}} options={{ facility: [{ value: 'F1', label: 'F1' }] }}
        onChange={() => {}} onRun={onRun} running={false} canRun
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /run|exécuter|executar/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it('shows the label and submits the value', async () => {
    const onChange = vi.fn();
    render(
      <ReportParametersBar
        report={report} params={{}}
        options={{ facility: [{ value: 'BAMAA', label: 'Aga Khan' }] }}
        onChange={onChange} onRun={() => {}} running={false} canRun
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    // The operator reads the name...
    await userEvent.click(await screen.findByText('Aga Khan'));
    // ...and the CODE is what gets filtered on.
    expect(onChange).toHaveBeenCalledWith({ facility: 'BAMAA' });
  });

  it('disables Run when canRun is false', () => {
    render(
      <ReportParametersBar
        report={report} params={{}} options={{}}
        onChange={() => {}} onRun={() => {}} running={false} canRun={false}
      />,
    );
    expect(screen.getByRole('button', { name: /run|exécuter|executar/i })).toBeDisabled();
  });

  it('shows a help tooltip trigger for a parameter that carries help text', () => {
    const withHelp: ReportSummary = {
      ...report,
      parameters: [{ id: 'request', label: 'Request ID', type: 'text', required: true, help: 'Accepts the lab number.' }],
    };
    render(<ReportParametersBar report={withHelp} params={{}} options={{}} onChange={() => {}} onRun={() => {}} running={false} canRun />);
    expect(screen.getByRole('button', { name: /about request id/i })).toBeInTheDocument();
  });

  it('shows no help trigger when the parameter has none', () => {
    const noHelp: ReportSummary = {
      ...report,
      parameters: [{ id: 'asOf', label: 'As of', type: 'text', required: false }],
    };
    render(<ReportParametersBar report={noHelp} params={{}} options={{}} onChange={() => {}} onRun={() => {}} running={false} canRun />);
    expect(screen.queryByRole('button', { name: /about as of/i })).not.toBeInTheDocument();
  });
});
