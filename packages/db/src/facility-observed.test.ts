import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OBSERVED_FACILITY_SYSTEM,
  FACILITY_REGISTRY_SYSTEM,
  observedFacilityConceptRow,
  registryConceptRows,
  registryPreferredCode,
  registryRowIdsWithSupersededIdConcept,
  facilityMapId,
  observedSystemForFeed,
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

  it('registryConceptRows keys the concept on local_code when present, displayed as name', () => {
    const [row] = registryConceptRows([
      { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' },
    ]);
    expect(row).toEqual({
      system: FACILITY_REGISTRY_SYSTEM,
      code: '111317-4',
      display: 'National Public Health Laboratory',
      status: 'ACTIVE',
      properties: null,
    });
  });

  it('registryConceptRows falls back to national_code when local_code is absent', () => {
    const [row] = registryConceptRows([
      { id: 'fac-2', name: 'Muhimbili National Hospital', nationalCode: 'TZ-001' },
    ]);
    expect(row.code).toBe('TZ-001');
  });

  // ⛔ The load-bearing collision guard. local_code is globally unique and (national_system,
  // national_code) is unique as a PAIR — but nothing stops row A's local_code from equalling row B's
  // national_code. Since concepts are keyed on (system, code) alone, a naive `localCode ?? nationalCode`
  // would silently merge these two DIFFERENT facilities into ONE concept.
  it('falls back to id for BOTH rows when their candidate codes collide, keeping them distinct', () => {
    const rows = registryConceptRows([
      { id: 'fac-a', name: 'Facility A', localCode: 'X' },
      { id: 'fac-b', name: 'Facility B', nationalCode: 'X' },
    ]);
    expect(rows.map((r) => r.code).sort()).toEqual(['fac-a', 'fac-b']);
  });

  it('a row whose candidate code is unique within the batch is unaffected by an unrelated collision elsewhere', () => {
    const rows = registryConceptRows([
      { id: 'fac-a', name: 'Facility A', localCode: 'X' },
      { id: 'fac-b', name: 'Facility B', nationalCode: 'X' },
      { id: 'fac-c', name: 'Facility C', localCode: 'UNIQUE' },
    ]);
    const c = rows.find((r) => r.display === 'Facility C');
    expect(c?.code).toBe('UNIQUE');
  });

  it('opts.forceOwnIdFor forces a row to its own id even without an in-batch collision', () => {
    const [row] = registryConceptRows(
      [{ id: 'fac-1', name: 'Solo Facility', localCode: 'SOLO' }],
      { forceOwnIdFor: new Set(['fac-1']) },
    );
    expect(row.code).toBe('fac-1');
  });

  it('registryPreferredCode prefers localCode, falls back to nationalCode, then null', () => {
    expect(registryPreferredCode({ localCode: 'LC', nationalCode: 'NC' })).toBe('LC');
    expect(registryPreferredCode({ nationalCode: 'NC' })).toBe('NC');
    expect(registryPreferredCode({})).toBeNull();
  });

  // The defect this fix closes: `0518e7d3` moved a row's concept `code` off its `id` onto its
  // operator-facing code, but projection is upsert-only, so the OLD id-keyed concept was left behind
  // forever — the same facility showing twice in the mapping picker. This is the shared seam both
  // `publishRegistryConcepts` and `projectRegistryRows` (packages/bootstrap/src/facility-reconcile.ts)
  // call with the SAME rows/opts they just handed to `registryConceptRows`, so "superseded" can never
  // drift from what was actually written.
  describe('registryRowIdsWithSupersededIdConcept', () => {
    it('flags a row whose id-keyed concept is superseded by a now-usable preferred code', () => {
      const ids = registryRowIdsWithSupersededIdConcept([
        { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' },
      ]);
      expect(ids).toEqual(['fac-1']);
    });

    // The collision-fallback case: the row's local_code differs from its id (so it is NOT the
    // "both columns null" case, which the CHECK constraint makes impossible for a real row), but
    // colliding with another row forces THIS row's projected code back to its own id anyway — so
    // there is nothing superseded. Deleting here would destroy the row's ONLY concept.
    it('does not flag a row whose candidate code collides and falls back to its own id', () => {
      const rows = [
        { id: 'fac-a', name: 'Facility A', localCode: 'X' },
        { id: 'fac-b', name: 'Facility B', nationalCode: 'X' },
      ];
      expect(registryRowIdsWithSupersededIdConcept(rows)).toEqual([]);
    });

    // `opts.forceOwnIdFor` (the `projectRegistryRows` DB-lookup collision guard) must feed the SAME
    // determination — a row forced to its own id by a collision discovered outside the batch is
    // exactly as un-superseded as an in-batch collision.
    it('does not flag a row forced to its own id via opts.forceOwnIdFor', () => {
      const rows = [{ id: 'fac-1', name: 'Solo Facility', localCode: 'SOLO' }];
      expect(
        registryRowIdsWithSupersededIdConcept(rows, { forceOwnIdFor: new Set(['fac-1']) }),
      ).toEqual([]);
    });

    it('returns ids only for rows actually passed in, never inventing one', () => {
      const rows = [
        { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' },
        { id: 'fac-2', name: 'Muhimbili National Hospital', nationalCode: 'TZ-001' },
      ];
      expect(registryRowIdsWithSupersededIdConcept(rows).sort()).toEqual(['fac-1', 'fac-2']);
    });
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

  // The wire's `performer[0].display` ("Aga Khan") seeds a NEW concept's display so the operator
  // sees a name, not the bare code ("BAMAA") — but only until an operator curates it (see the
  // `existing` case below, which must still win).
  it('seeds a new concept from defaultDisplay when there is no existing curated display', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'BAMAA',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 5,
      defaultDisplay: 'Aga Khan',
    });
    expect(row.code).toBe('BAMAA');
    expect(row.display).toBe('Aga Khan');
  });

  it('falls back to the bare code when defaultDisplay is absent', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'BAMAA',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 5,
    });
    expect(row.display).toBe('BAMAA');
  });

  it('an existing curated display always wins over defaultDisplay', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'BAMAA',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 5,
      defaultDisplay: 'Aga Khan',
      existing: { display: 'Aga Khan Hospital, Dar es Salaam', properties: null },
    });
    expect(row.display).toBe('Aga Khan Hospital, Dar es Salaam');
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

describe('observedSystemForFeed', () => {
  it('maps the default ingest feed (webhook-ingest) to the default system', () => {
    expect(observedSystemForFeed('webhook-ingest')).toBe(DEFAULT_OBSERVED_FACILITY_SYSTEM);
  });

  // Decision (task brief, resolved explicitly): a NULL/blank source_system is treated as the
  // default feed, not a new "unknown feed" system — see the doc comment on observedSystemForFeed.
  it('maps a null source_system to the default system', () => {
    expect(observedSystemForFeed(null)).toBe(DEFAULT_OBSERVED_FACILITY_SYSTEM);
  });

  it('maps a blank/whitespace-only source_system to the default system', () => {
    expect(observedSystemForFeed('')).toBe(DEFAULT_OBSERVED_FACILITY_SYSTEM);
    expect(observedSystemForFeed('   ')).toBe(DEFAULT_OBSERVED_FACILITY_SYSTEM);
  });

  it('gives a non-default feed its own deterministic system, distinct from the default', () => {
    const system = observedSystemForFeed('feed-a');
    expect(system).not.toBe(DEFAULT_OBSERVED_FACILITY_SYSTEM);
    expect(system).toBe(observedSystemForFeed('feed-a'));
  });

  it('gives two distinct feeds two distinct systems', () => {
    expect(observedSystemForFeed('feed-a')).not.toBe(observedSystemForFeed('feed-b'));
  });

  it('a feed name that slugifies to empty still gets a system distinct from the default', () => {
    const system = observedSystemForFeed('///');
    expect(system).not.toBe(DEFAULT_OBSERVED_FACILITY_SYSTEM);
    expect(system.startsWith('urn:openldr:fac_')).toBe(true);
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
