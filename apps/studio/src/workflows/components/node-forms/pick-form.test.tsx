import { describe, it, expect } from 'vitest';
import { pickForm } from './index';
import { DeclarativeNodeForm } from './plugin-node-form';
import { SqlForm } from './sql-form';
import { DefaultForm } from './default-form';
import { MapToFhirForm } from './map-to-fhir-form';

const mk = (data: Record<string, unknown>, type = 'action') => ({ id: 'n', type, data }) as never;

describe('pickForm routing', () => {
  it('routes form-validate to the declarative form', () => {
    expect(pickForm(mk({ templateId: 'form-validate', action: 'form-validate' }))).toBe(DeclarativeNodeForm);
  });

  it('routes persist-store to the declarative form', () => {
    expect(pickForm(mk({ templateId: 'persist-store', action: 'persist-store' }))).toBe(DeclarativeNodeForm);
  });

  it('routes map-to-fhir to its own form, with or without a templateId', () => {
    expect(pickForm(mk({ templateId: 'map-to-fhir', action: 'map-to-fhir' }))).toBe(MapToFhirForm);
    expect(pickForm(mk({ action: 'map-to-fhir' }))).toBe(MapToFhirForm);
  });

  it('still routes a registered host node to its bespoke form', () => {
    expect(pickForm(mk({ templateId: 'sql-query' }))).toBe(SqlForm);
  });

  it('falls back to the declarative form for an unregistered action node', () => {
    expect(pickForm(mk({ templateId: 'some-future-host-node', action: 'some-future-host-node' }))).toBe(DeclarativeNodeForm);
  });

  it('falls back to DefaultForm for an unregistered non-action node', () => {
    expect(pickForm(mk({ templateId: 'mystery' }, 'mystery'))).toBe(DefaultForm);
  });
});
