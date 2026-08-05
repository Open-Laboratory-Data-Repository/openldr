import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OBSERVED_FACILITY_SYSTEM,
  FACILITY_REGISTRY_SYSTEM,
  observedFacilityConceptRow,
  facilityMapId,
} from './facility-observed';

describe('facility-observed', () => {
  it('uses the established urn:openldr naming', () => {
    expect(DEFAULT_OBSERVED_FACILITY_SYSTEM).toBe('urn:openldr:default_fac');
    expect(FACILITY_REGISTRY_SYSTEM).toBe('urn:openldr:cs:facility-registry');
  });

  // ⛔ The load-bearing assertion of this whole slice. Equality against the exact mixed-case
  // string is what makes it able to fail: a case-insensitive comparison would pass against the
  // very bug it exists to catch.
  it('keeps the observed string byte-for-byte as the concept code', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'Ocean Road Cancer Institute (O',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 6,
    });
    expect(row.code).toBe('Ocean Road Cancer Institute (O');
    expect(row.display).toBe('Ocean Road Cancer Institute (O');
    expect(row.status).toBe('ACTIVE');
  });

  it('does not upper-case, unlike openldr-v2 normalizeCode', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'Dodoma',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 247,
    });
    expect(row.code).toBe('Dodoma');
    expect(row.code).not.toBe('DODOMA');
  });

  it('records provenance in properties', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'HYDOH',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 99,
    });
    expect(row.properties).toEqual({
      firstSeen: '2026-08-05T00:00:00.000Z',
      lastSeen: '2026-08-05T00:00:00.000Z',
      reportCount: 99,
    });
  });

  it('preserves firstSeen and a curated display when merging over an existing concept', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'HYDOH',
      seenAt: '2026-08-06T00:00:00.000Z',
      reportCount: 104,
      existing: {
        display: 'Hydom Lutheran Hospital',
        properties: { firstSeen: '2026-08-01T00:00:00.000Z', lastSeen: '2026-08-05T00:00:00.000Z', reportCount: 99 },
      },
    });
    expect(row.display).toBe('Hydom Lutheran Hospital');
    expect(row.properties).toEqual({
      firstSeen: '2026-08-01T00:00:00.000Z',
      lastSeen: '2026-08-06T00:00:00.000Z',
      reportCount: 104,
    });
  });

  it('derives a deterministic, bounded facility_map id', () => {
    expect(facilityMapId('webhook-ingest', 'Dodoma')).toBe('webhook-ingest|Dodoma');
    expect(facilityMapId('webhook-ingest', 'Dodoma')).toBe(facilityMapId('webhook-ingest', 'Dodoma'));
    const long = facilityMapId('webhook-ingest', 'x'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(200);
  });
});

describe('facility-observed.ts stays browser-safe', () => {
  // This module is published as its own subpath (@openldr/db/facility-observed, see package.json)
  // specifically so apps/studio can import it (Observed tab) without pulling in `pg`/kysely and the
  // rest of the server DB engine. A runtime (non type-only) import added here later — even an
  // innocuous-looking one — would silently break the studio Vite bundle rather than fail loudly, so
  // this asserts the invariant directly against the source text rather than trusting a comment.
  it('has no runtime (non type-only) imports', () => {
    const path = fileURLToPath(new URL('./facility-observed.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const importLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '));

    for (const line of importLines) {
      expect(line.startsWith('import type '), `runtime import found: ${line}`).toBe(true);
    }
  });
});
