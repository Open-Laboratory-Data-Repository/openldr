import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';

const mocks = vi.hoisted(() => ({
  canManage: false,
  gender: {
    id: 'vs-g', url: 'http://hl7.org/fhir/ValueSet/administrative-gender', name: 'AdministrativeGender',
    title: 'AdministrativeGender', version: null, status: 'active', immutable: true, publisherId: 'pub-hl7-fhir',
    category: null, codeCount: 4, primarySystem: null,
  },
}));

vi.mock('../../api', () => ({
  listValueSets: vi.fn(async () => [mocks.gender]),
  storedValueSetCodes: vi.fn(async () => [
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'male', display: 'Male' },
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'female', display: 'Female' },
  ]),
  saveValueSet: vi.fn(async (input: { url: string }) => ({ id: 'vs-new', url: input.url })),
}));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: () => mocks.canManage }) }));

import * as api from '../../api';
import { OptionsBlock } from './OptionsBlock';

const SELECT: FormField = {
  id: 'sex', displayLabel: 'Sex', fieldType: 'select', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
};

function Harness({ field, surveyMode, onUpdate }: { field: FormField; surveyMode: boolean; onUpdate: (p: Partial<FormField>) => void }) {
  const [current, setCurrent] = useState(field);
  return <OptionsBlock field={current} surveyMode={surveyMode} onUpdate={(p) => { onUpdate(p); setCurrent((f) => ({ ...f, ...p })); }} />;
}

function renderBlock(extra: Partial<FormField> = {}, surveyMode = false) {
  const onUpdate = vi.fn();
  render(<Harness field={{ ...SELECT, ...extra }} surveyMode={surveyMode} onUpdate={onUpdate} />);
  return { onUpdate };
}

function clickMenu(item: string) {
  const trigger = screen.getByRole('button', { name: 'Options actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('OptionsBlock', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.canManage = false; });

  it('binds a picked set, copying its stored codes', async () => {
    const { onUpdate } = renderBlock();
    fireEvent.focus(screen.getByLabelText('Bind to a ValueSet…'));
    fireEvent.click((await screen.findByText('AdministrativeGender')).closest('button')!);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      valueSetUrl: mocks.gender.url, bindingStrength: 'extensible',
      valueSetOptions: [{ code: 'male', display: 'Male' }, { code: 'female', display: 'Female' }],
    }));
    expect(api.storedValueSetCodes).toHaveBeenCalledWith('vs-g');
    expect(await screen.findByText('2 codes from AdministrativeGender')).toBeTruthy();
  });

  it('a required strength forbids custom values', async () => {
    const { onUpdate } = renderBlock({ valueSetUrl: mocks.gender.url, bindingStrength: 'extensible', valueSetOptions: [{ code: 'male', display: 'Male' }] });
    fireEvent.click(screen.getByRole('combobox', { name: 'Strength' }));
    fireEvent.click(await screen.findByRole('option', { name: 'required' }));
    expect(onUpdate).toHaveBeenCalledWith({ bindingStrength: 'required', allowCustomValue: false });
  });

  it('Unbind keeps the options and drops the link', () => {
    const { onUpdate } = renderBlock({ valueSetUrl: mocks.gender.url, bindingStrength: 'required', valueSetOptions: [{ code: 'male', display: 'Male' }] });
    clickMenu('Unbind');
    expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: undefined, bindingStrength: undefined });
    expect(screen.getByDisplayValue('male')).toBeTruthy();
  });

  it("Load from terminology fills the options from the element's standard set, without binding", async () => {
    const { onUpdate } = renderBlock({ fhirPath: 'Patient.gender' });
    await screen.findByRole('button', { name: 'Options actions' });
    clickMenu('Load from terminology');
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      valueSetOptions: [{ code: 'male', display: 'Male' }, { code: 'female', display: 'Female' }],
    }));
  });

  it('offers no Load from terminology on a survey form', () => {
    renderBlock({ fhirPath: 'Patient.gender' }, true);
    expect(screen.queryByRole('button', { name: 'Options actions' })).toBeNull();
  });

  it('offers Save as a new ValueSet only to a user who may manage terminology', () => {
    renderBlock({ valueSetOptions: [{ code: 'opd', display: 'OPD' }] });
    expect(screen.queryByRole('button', { name: 'Options actions' })).toBeNull();
  });

  it('saves typed options as a set and binds the field to it', async () => {
    mocks.canManage = true;
    const { onUpdate } = renderBlock({ displayLabel: 'Ward', valueSetOptions: [{ code: 'opd', display: 'OPD' }] });
    clickMenu('Save as a new ValueSet');
    const trigger = await screen.findByRole('button', { name: 'Save actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Save' })) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(api.saveValueSet).toHaveBeenCalledWith(expect.objectContaining({ url: 'urn:openldr:valueset:ward', title: 'Ward' })));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: 'urn:openldr:valueset:ward', bindingStrength: 'extensible' }));
  });
});
