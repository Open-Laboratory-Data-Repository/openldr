import { describe, it, expect } from 'vitest';
import { seededStarterPacks, shapeOf, type SavedMapping } from '@openldr/forms';
import { validateBatch } from '@openldr/fhir';
import { projectObservation, projectServiceRequest, projectSpecimen } from '@openldr/db';
import { createMapToFhirService } from './map-to-fhir-service';

// Made-up values only. A plain text in a coded field must reach the warehouse as the lab's own code.

const PACKS = seededStarterPacks().map((p) => ({ id: p.id, resourceType: p.resourceType, entries: p.entries }));

const row = {
  pat_no: 'T-0001',
  collected: '2026-11-03T08:30:00Z',
  spec_type: 'QZX-SPEC',
  panel: 'QZX-PANEL',
  test: 'QZX-TEST',
  flag: 'QZX-FLAG',
  result: '12.5',
};

const mapping: SavedMapping = {
  shapeHash: shapeOf(row).hash,
  fieldNames: Object.keys(row).sort(),
  targetId: 'lab-result',
  rows: [
    { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
    { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'collected' } },
    { targetPath: 'Specimen.type', from: { field: 'spec_type' } },
    { targetPath: 'ServiceRequest.code', from: { field: 'panel' } },
    { targetPath: 'Observation.code', from: { field: 'test' } },
    { targetPath: 'Observation.interpretation', from: { field: 'flag' } },
    { targetPath: 'Observation.valueQuantity.value', from: { field: 'result' } },
  ],
};

describe('a mapped row with plain-text codes, through the warehouse projections', () => {
  it('fills observation_code, panel_code, the specimen type code and abnormal_flag with the text', async () => {
    const svc = createMapToFhirService({
      forms: { get: async () => null },
      validateForm: async () => {
        throw new Error('not called');
      },
      packs: async () => PACKS,
      translateCode: async () => null,
      validate: (resources, known) => validateBatch(resources, { level: 'high', resolveServiceRequest: async (id) => known.has(id) }),
    });
    const res = await svc({ items: [{ json: row }], config: { targetId: 'lab-result', formIds: [], mappings: [mapping] } });
    expect(res.held).toEqual([]);
    const byType = (t: string) => res.out.find((i) => i.json.resourceType === t)!.json;

    const obs = projectObservation(byType('Observation'), {});
    expect(obs.observation_code).toBe('QZX-TEST');
    expect(obs.observation_system).toBeNull();
    expect(obs.abnormal_flag).toBe('QZX-FLAG');
    expect(projectServiceRequest(byType('ServiceRequest'), {}).panel_code).toBe('QZX-PANEL');
    expect(projectSpecimen(byType('Specimen'), {}).type_code).toBe('QZX-SPEC');
  });
});
