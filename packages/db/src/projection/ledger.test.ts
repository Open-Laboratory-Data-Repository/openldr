import { describe, it, expect } from 'vitest';
import { LEDGER_RESOURCE_TYPES, toArrivalEvent } from './ledger';

describe('LEDGER_RESOURCE_TYPES', () => {
  it('covers the clinical resources a laboratory transmits', () => {
    for (const t of ['ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport', 'Patient']) {
      expect(LEDGER_RESOURCE_TYPES, `${t} must be recorded`).toContain(t);
    }
  });

  it('excludes config and reference resources, which churn on every edit', () => {
    // Measured 2026-08-17 on the dev warehouse: Organization 46.4 versions each, Questionnaire 93.0,
    // Location 399.0 — against 2.0-2.2 for every clinical type. Including them would let one
    // operator editing a Questionnaire look identical to a laboratory transmitting, and they would
    // dominate the table.
    for (const t of ['Organization', 'Questionnaire', 'Location', 'ValueSet']) {
      expect(LEDGER_RESOURCE_TYPES, `${t} must NOT be recorded`).not.toContain(t);
    }
  });
});

describe('toArrivalEvent', () => {
  it('maps a resource_history row to the ArrivalEvent shape', () => {
    const recordedAt = new Date('2026-08-17T12:00:00.000Z');
    const event = toArrivalEvent({
      resource_type: 'ServiceRequest', id: 'sr-1', version: 2, recorded_at: recordedAt,
    });
    expect(event).toEqual({
      resource_type: 'ServiceRequest', resource_id: 'sr-1', version: 2, recorded_at: recordedAt,
    });
  });

  it('normalizes a string/bigint version to a number', () => {
    const recordedAt = new Date('2026-08-17T12:00:00.000Z');
    expect(toArrivalEvent({ resource_type: 'Patient', id: 'p-1', version: '7', recorded_at: recordedAt }).version)
      .toBe(7);
    expect(toArrivalEvent({ resource_type: 'Patient', id: 'p-1', version: 7n, recorded_at: recordedAt }).version)
      .toBe(7);
  });
});
