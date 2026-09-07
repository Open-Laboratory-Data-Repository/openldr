import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompareDialog } from './CompareDialog';
import * as api from '../api';
import { normalizeFormSchema } from '@openldr/forms/pure';

const NOW = '2026-01-01T00:00:00.000Z';

function summary(v: number, label: string) {
  return {
    id: `fv-${v}`, formId: 'form-1', version: v, versionLabel: label,
    name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'],
    publishedAt: NOW, publishedBy: 'u1',
  };
}

function snapshot(v: number, fieldId: string) {
  return {
    ...summary(v, `v${v}`),
    questionnaire: {},
    schema: { id: 'specimen-intake', name: 'Specimen intake', fields: [{ id: fieldId, displayLabel: fieldId, fieldType: 'text' }], sections: [] },
  };
}

const draft = normalizeFormSchema({
  id: 'specimen-intake', name: 'Specimen intake',
  fields: [{ id: 'draftOnly', displayLabel: 'draftOnly', fieldType: 'text' }], sections: [],
});

describe('CompareDialog', () => {
  it('defaults to newest published against the current draft', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([summary(2, 'v2'), summary(1, 'v1')]);
    vi.spyOn(api, 'getFormVersion').mockImplementation(async (_id, v) => snapshot(v, `v${v}Field`) as never);

    render(<CompareDialog formId="form-1" current={draft} open onOpenChange={() => {}} />);

    await waitFor(() => expect(api.getFormVersion).toHaveBeenCalledWith('form-1', 2));
    expect(await screen.findByText(/draftOnly/)).toBeInTheDocument();
  });

  it('compares two published versions when both sides are chosen', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([summary(2, 'v2'), summary(1, 'v1')]);
    const get = vi.spyOn(api, 'getFormVersion').mockImplementation(async (_id, v) => snapshot(v, `v${v}Field`) as never);

    render(<CompareDialog formId="form-1" current={draft} open onOpenChange={() => {}} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 2));

    // Right side moves off the draft and onto v1.
    fireEvent.click(screen.getByLabelText('Compare to'));
    fireEvent.click(await screen.findByRole('option', { name: /v1/ }));

    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 1));
    expect(await screen.findByText(/v1Field/)).toBeInTheDocument();
    expect(screen.queryByText(/draftOnly/)).not.toBeInTheDocument();
  });

  it('names both selected sides in the header, not the draft', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([summary(2, 'v2'), summary(1, 'v1')]);
    const get = vi.spyOn(api, 'getFormVersion').mockImplementation(async (_id, v) => snapshot(v, `v${v}Field`) as never);

    const { container } = render(<CompareDialog formId="form-1" current={draft} open onOpenChange={() => {}} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 2));

    // Right side moves off the draft and onto v1, so both sides are published versions.
    fireEvent.click(screen.getByLabelText('Compare to'));
    fireEvent.click(await screen.findByRole('option', { name: /v1/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 1));

    const header = container.querySelector('.border-b p.mt-1');
    await waitFor(() => {
      expect(header?.textContent).toContain('v2');
      expect(header?.textContent).toContain('v1');
    });
    expect(header?.textContent?.toLowerCase()).not.toContain('draft');
  });

  it('moves the left selector to a different published version', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([summary(2, 'v2'), summary(1, 'v1')]);
    const get = vi.spyOn(api, 'getFormVersion').mockImplementation(async (_id, v) => snapshot(v, `v${v}Field`) as never);

    render(<CompareDialog formId="form-1" current={draft} open onOpenChange={() => {}} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 2));

    // Left side moves off v2 and onto v1; right stays on the draft.
    fireEvent.click(screen.getByLabelText('Compare from'));
    fireEvent.click(await screen.findByRole('option', { name: /v1/ }));

    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 1));
    expect(await screen.findByText(/v1Field/)).toBeInTheDocument();
    expect(screen.queryByText(/v2Field/)).not.toBeInTheDocument();
  });
});
