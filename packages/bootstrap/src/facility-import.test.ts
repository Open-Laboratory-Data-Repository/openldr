import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFacilityRegistryStore, createTerminologyAdminStore, createFacilityJobStore, referenceCapture,
  FACILITY_REGISTRY_SYSTEM, type InternalSchema, type TerminologyAdminStore, type FacilityJobStore,
} from '@openldr/db';
import { importFacilities, type FacilityImportDeps } from './facility-import';

const SYSTEM = 'urn:tz:hfr';

async function buildDeps(): Promise<FacilityImportDeps & { db: Kysely<InternalSchema> }> {
  const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
  return { db, capture: referenceCapture };
}

async function rowFor(db: Kysely<InternalSchema>, nationalCode: string) {
  return db.selectFrom('facility_registry').selectAll().where('national_code', '=', nationalCode).executeTakeFirst();
}

const HEADER = 'national_code,name,level,ownership,status,country,zone,region,district,council,ward,village,address,phone,latitude,longitude';

function csv(rows: string[]): string {
  return [HEADER, ...rows].join('\n') + '\n';
}

function jsonl(lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

const rowLine = (mflId: string, name: string, over: Record<string, unknown> = {}) =>
  ({ type: 'row', mflId, name, ...over });
const deletionLine = (mflId: string) => ({ type: 'deletion', mflId });

describe('importFacilities', () => {
  it('dry-run reports parsed/skipped/unknownColumns and writes nothing', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,', ',No Code,,,,,,,,,,,,,,']); // second row missing required national_code
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM });
    // ⛔ A COMPLETE-object assertion, deliberately, and it must stay one. Nothing else pins the
    // shape of this result: `importFacilities` is called through `@openldr/bootstrap`'s barrel by a
    // route, the CLI and (via a hand-mirrored interface) the studio, none of which would fail to
    // compile if a field silently disappeared. Weakening this to `toMatchObject` would let the next
    // reshape drop a counter unnoticed — which is how `created: 0, updated: 0` survived as a dry
    // run's answer for three slices.
    expect(result).toEqual({
      parsed: 1, skipped: 1, unknownColumns: [], duplicateColumns: [], quarantined: [], invalid: [],
      duplicates: 0, blocked: false, blockedReason: null,
      // The row does not exist in the registry, so it would be created — reported on a DRY RUN,
      // where nothing is written. That distinction is the entire point of the two vocabularies.
      create: 1, changed: 0, unchanged: 0,
      // null, never 0: no watermark was supplied, so no conflict was evaluated; and the file was
      // not declared a complete release, so absence means nothing.
      conflict: null, absent: null, deleted: 0,
      samples: {
        create: [{ id: 'fac-0eea98ab9108599d', nationalCode: '100', name: 'Dodoma Regional Referral' }],
        changed: [], conflict: [], absent: [], deleted: [],
      },
      written: { created: 0, updated: 0 },
      runId: null, knownNationalSystem: true,
    });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('apply inserts new rows and updates existing ones in place; re-import is idempotent on id', async () => {
    const deps = await buildDeps();
    const first = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    const r1 = await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    expect(r1).toMatchObject({ parsed: 1, create: 1, written: { created: 1, updated: 0 } });
    const row1 = await rowFor(deps.db, '100');
    expect(row1?.name).toBe('Dodoma Regional Referral');
    const idAfterFirst = row1?.id;

    // Re-import the SAME register unchanged: same national_code+system ⇒ same hashed id, so the row
    // is FOUND rather than duplicated. It is also byte-identical, so nothing is written to it —
    // `unchanged: 1` with an empty `written`, not the `updated: 1` this used to assert (FAC-P1-03).
    const r2 = await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    expect(r2).toMatchObject({ parsed: 1, create: 0, unchanged: 1, written: { created: 0, updated: 0 } });
    const row2 = await rowFor(deps.db, '100');
    expect(row2?.id).toBe(idAfterFirst);

    // A NEW release of the register with a renamed facility (same code) updates in place, not a new row.
    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    const r3 = await importFacilities(deps, renamed, { nationalSystem: SYSTEM, apply: true });
    expect(r3).toMatchObject({ changed: 1, written: { created: 0, updated: 1 } });
    const row3 = await rowFor(deps.db, '100');
    expect(row3?.id).toBe(idAfterFirst);
    expect(row3?.name).toBe('Dodoma Regional Referral Hospital');

    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(1);
  });

  it('a row already present keeps its id (re-import is an in-place update)', async () => {
    const deps = await buildDeps();
    const first = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    const row = await rowFor(deps.db, '100');
    const id = row!.id;

    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    await importFacilities(deps, renamed, { nationalSystem: SYSTEM, apply: true });

    const rowAfter = await rowFor(deps.db, '100');
    expect(rowAfter?.id).toBe(id);
    expect(rowAfter?.name).toBe('Dodoma Regional Referral Hospital');
  });

  it('unknown columns block the import unless allowed, then land in extras', async () => {
    const deps = await buildDeps();
    const withExtra = ['national_code,name,beds', '100,Dodoma Regional Referral,250'].join('\n') + '\n';

    const blocked = await importFacilities(deps, withExtra, { nationalSystem: SYSTEM, apply: true });
    // The second complete-object assertion in this file, and the only one covering a file the
    // PARSER refused: every bucket must read zero/empty here because there is genuinely nothing to
    // classify — `records: []` — not because the comparison was skipped.
    expect(blocked).toEqual({
      parsed: 0, skipped: 0, unknownColumns: ['beds'], duplicateColumns: [], quarantined: [], invalid: [],
      // NOT blocked: unrecognised columns are refused by the PARSER (records: []), which is a
      // different mechanism from `blocked` — that one is about a file the parser accepted.
      duplicates: 0, blocked: false, blockedReason: null,
      create: 0, changed: 0, unchanged: 0, conflict: null, absent: null, deleted: 0,
      samples: { create: [], changed: [], conflict: [], absent: [], deleted: [] },
      written: { created: 0, updated: 0 },
      runId: null, knownNationalSystem: true,
    });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);

    const allowed = await importFacilities(deps, withExtra, { nationalSystem: SYSTEM, allowUnknownColumns: true, apply: true });
    expect(allowed).toMatchObject({ parsed: 1, unknownColumns: ['beds'], written: { created: 1, updated: 0 } });
    const row = await rowFor(deps.db, '100');
    expect(row?.extras).toMatchObject({ beds: '250' });
  });

  it('rows missing a required field are counted in skipped, not thrown', async () => {
    const deps = await buildDeps();
    const body = csv([
      '100,Dodoma Regional Referral,,,,,,,,,,,,,,',
      ',Missing Code,,,,,,,,,,,,,,',
      '200,,,,,,,,,,,,,,,',
    ]);
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    expect(result).toMatchObject({ parsed: 1, skipped: 2, written: { created: 1, updated: 0 } });
  });

  it('a ragged row does not throw', async () => {
    const deps = await buildDeps();
    const body = [HEADER, '100,Dodoma Regional Referral', '200,Muhimbili,,,,,,,,,,,,,,,,,,,,extra,columns,here'].join('\n') + '\n';
    await expect(importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true })).resolves.toMatchObject({ skipped: 0 });
  });

  it('rows absent from the import are NOT deleted', async () => {
    const deps = await buildDeps();
    const store = createFacilityRegistryStore(deps.db);
    await store.upsert({ id: 'manual-1', localCode: 'LAB01', name: 'Hand-entered facility', source: 'manual' });

    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    expect(await store.get('manual-1')).toMatchObject({ name: 'Hand-entered facility' });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(2);
  });

  it('managed_origin is NULL on every imported row', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,', '200,Muhimbili,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    const rows = await deps.db.selectFrom('facility_registry').selectAll().execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.managed_origin).toBeNull();
  });

  // Task 1 (facilities-phase-0): this used to assert the OPPOSITE — that a created row (and an
  // unchanged re-import) DID land reference_change_log rows. That pinned the defective behaviour:
  // facility_registry had capture live with no serve/apply case, so a logged upsert reached a lab as
  // a bogus delete. The batched-create + per-row-update capture legs are gone from importFacilities
  // now; see SUSPENDED_REFERENCE_ENTITY_TYPES in reference-change-log.ts.
  it('does not log any reference_change_log row for a created row, even with capture supplied', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    // A RENAMED re-import, not a byte-identical one: since FAC-P1-03 an unchanged row is not written
    // at all, so re-importing the same file would exercise neither leg and this assertion would hold
    // vacuously. The rename is classified `changed` and really is written.
    await importFacilities(deps, csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const log = await deps.db.selectFrom('reference_change_log').selectAll().where('entity_type', '=', 'facility_registry').execute();
    expect(log).toEqual([]);
  });

  it('omitting capture writes facility_registry rows without touching reference_change_log', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities({ db }, body, { nationalSystem: SYSTEM, apply: true });
    expect(await rowFor(db, '100')).toBeDefined();
    expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(0);
  });

  // ⛔ Critical 1 regression test. pg-mem (this suite's oracle) does NOT enforce Postgres's rule
  // that a single multi-row `INSERT ... ON CONFLICT (id) DO UPDATE` may not target the same
  // conflict key twice — so asserting only that the import "succeeds" proves nothing here; it would
  // succeed on pg-mem either way. Instead this pins the observable side effect that only reads right
  // when the duplicate is collapsed before classification: without dedupe, both same-id rows are
  // (wrongly) classified `create` against the same existing-row lookup, so `written.created` would
  // read 2, not 1. (This regression test originally also checked for a doubled
  // reference_change_log row on the surviving id — moot now that facility_registry capture is
  // suspended; see the test above.)
  it('duplicate national_code rows within one file collapse to one row (last wins) and are reported', async () => {
    const deps = await buildDeps();
    const body = csv([
      '100,First Name,,,,,,,,,,,,,,',
      '100,Second Name (final),,,,,,,,,,,,,,',
    ]);
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    expect(result).toMatchObject({ parsed: 2, written: { created: 1, updated: 0 }, duplicates: 1 });

    const rows = await deps.db.selectFrom('facility_registry').selectAll().where('national_code', '=', '100').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Second Name (final)');
  });

  it('a dry run also reports duplicates, without writing anything', async () => {
    const deps = await buildDeps();
    const body = csv([
      '100,First Name,,,,,,,,,,,,,,',
      '100,Second Name,,,,,,,,,,,,,,',
    ]);
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM });
    // `create: 1`, not 2: the duplicate is collapsed BEFORE classification, so a dry run's headline
    // number already describes the one row an apply would write.
    expect(result).toMatchObject({ parsed: 2, create: 1, written: { created: 0, updated: 0 }, duplicates: 1 });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  // The 🟠 Important 1 regression test that used to live here (hashOf/contentHashOf drift caught via
  // a spurious second reference_change_log row) is removed: its whole premise was comparing the two
  // hashing schemes' effect on a log write, and neither path writes to reference_change_log anymore
  // (facility_registry capture is suspended — see the test above). A `toHaveLength(0)` here would
  // hold regardless of whether the two hashers agree, so it would no longer catch that drift; it
  // would just be theatre.

  // Pins `updated_at: sql`now()`` on the row importFacilities writes for an UPDATE:
  // insertBatchPg's ON CONFLICT DO UPDATE only ever updates the columns present in the row, so if
  // that field were ever dropped, a re-import of an already-existing row would silently leave
  // updated_at at its insert-time value. No test previously read updated_at at all.
  // ⚠ The second import RENAMES the facility on purpose. A byte-identical re-import is classified
  // `unchanged` and writes nothing at all now, so it could not bump updated_at even with the
  // fragment present — and that is correct, not a regression (FAC-P1-03).
  it('a re-import of an existing row bumps updated_at', async () => {
    const deps = await buildDeps();
    const first = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    const afterFirst = await rowFor(deps.db, '100');
    const updatedAtAfterFirst = new Date(afterFirst!.updated_at);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    const r2 = await importFacilities(deps, renamed, { nationalSystem: SYSTEM, apply: true });
    expect(r2).toMatchObject({ changed: 1, written: { created: 0, updated: 1 } });

    const afterSecond = await rowFor(deps.db, '100');
    expect(new Date(afterSecond!.updated_at).getTime()).toBeGreaterThan(updatedAtAfterFirst.getTime());
  });

  // 🟠 Important 2 regression tests. Measured before this fix: hand-edit a row to localCode:'LAB01',
  // extras:{ward_contact:'Ada'}, re-import the same register -> localCode:null, extras:{}. The
  // importer only produces the national fields it parses; it must not blank operator-entered data
  // it never had in the first place.
  it('a re-import preserves an operator-assigned local_code instead of blanking it', async () => {
    const deps = await buildDeps();
    const store = createFacilityRegistryStore(deps.db);
    const first = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    const row = await rowFor(deps.db, '100');
    const id = row!.id;

    const stored = await store.get(id);
    await store.upsert({ ...stored!, localCode: 'LAB01' });
    expect((await store.get(id))?.localCode).toBe('LAB01');

    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    const r2 = await importFacilities(deps, renamed, { nationalSystem: SYSTEM, apply: true });
    expect(r2).toMatchObject({ changed: 1, written: { created: 0, updated: 1 } });

    const after = await store.get(id);
    expect(after?.localCode).toBe('LAB01');
    expect(after?.name).toBe('Dodoma Regional Referral Hospital');
  });

  it('a re-import shallow-merges extras: incoming keys win, untouched operator-curated keys survive', async () => {
    const deps = await buildDeps();
    const store = createFacilityRegistryStore(deps.db);
    const first = ['national_code,name,beds', '100,Dodoma Regional Referral,250'].join('\n') + '\n';
    await importFacilities(deps, first, { nationalSystem: SYSTEM, allowUnknownColumns: true, apply: true });
    const row = await rowFor(deps.db, '100');
    const id = row!.id;
    expect(row?.extras).toMatchObject({ beds: '250' });

    const stored = await store.get(id);
    await store.upsert({ ...stored!, extras: { ...(stored!.extras ?? {}), ward_contact: 'Ada' } });
    expect((await store.get(id))?.extras).toMatchObject({ beds: '250', ward_contact: 'Ada' });

    // ward_contact is not in this (or any) CSV column and must survive; beds IS in this file and
    // its new value must win over the operator-curated snapshot.
    const second = ['national_code,name,beds', '100,Dodoma Regional Referral,300'].join('\n') + '\n';
    const r2 = await importFacilities(deps, second, { nationalSystem: SYSTEM, allowUnknownColumns: true, apply: true });
    expect(r2).toMatchObject({ changed: 1, written: { created: 0, updated: 1 } });

    const after = await store.get(id);
    expect(after?.extras).toMatchObject({ beds: '300', ward_contact: 'Ada' });
  });

  // Task 4 (facilities-phase-0): a structurally malformed row (field count != header's — see
  // facility-csv.ts's `quarantined`) must not be silently skipped into an otherwise-successful apply.
  // These tests use raw CSV bodies rather than the `csv()` helper above, since that helper always
  // pads to the fixed 16-column HEADER and can't produce a row whose field count actually disagrees.
  it('refuses to apply while any row is quarantined, and writes nothing', async () => {
    const deps = await buildDeps();
    const body = 'national_code,name\n1,Good\n2,Bad,Extra\n';

    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    expect(result.written).toEqual({ created: 0, updated: 0 });
    expect(result.quarantined).toHaveLength(1);
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('applies the good rows when allowMalformedRows is set, and still reports the bad one', async () => {
    const deps = await buildDeps();
    const body = 'national_code,name\n1,Good\n2,Bad,Extra\n3,AlsoGood\n';

    const result = await importFacilities(deps, body, {
      nationalSystem: SYSTEM, apply: true, allowMalformedRows: true,
    });

    expect(result.written.created).toBe(2);
    expect(result.quarantined).toHaveLength(1);
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(2);
  });

  it('reports quarantined rows on a dry run without needing the override', async () => {
    const deps = await buildDeps();
    const body = 'national_code,name\n1,Good\n2,Bad,Extra\n';

    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM });

    expect(result.quarantined).toHaveLength(1);
    expect(result.parsed).toBe(1);
  });

  // Minor 4. Pins the deliberate deviation from the brief's `blocked || records.length === 0` guard
  // (see the docblock's "One deliberate deviation" section): `importFacilities` loads existing rows
  // whenever `records.length > 0`, blocked or not, precisely so a BLOCKED-but-non-empty preview still
  // compares against the registry instead of reporting a false `create`. This is the studio's most
  // common preview shape — `ImportFacilitiesSheet.tsx` pins `allowMalformedRows: false` on every
  // preview request, so a file with even one ragged row is blocked (`'quarantined-rows'`) on every
  // studio preview by construction, yet the good rows in that same file are routinely already applied
  // from a previous run. Restoring `blocked ||` would silently regress this to `existing = new Map()`
  // and every already-applied row would misreport `create` instead of `unchanged`.
  it('a preview of a quarantined-but-non-empty file reports an already-applied row as unchanged, not create', async () => {
    const deps = await buildDeps();
    const body = 'national_code,name\n1,Good\n2,Bad,Extra\n';
    const applied = await importFacilities(
      deps, body, { nationalSystem: SYSTEM, apply: true, allowMalformedRows: true },
    );
    expect(applied.written).toEqual({ created: 1, updated: 0 });

    // Same file, previewed (no `apply`) WITHOUT the override this time — blocked, but non-empty:
    // `records` still has the one good row, since only row 2 is quarantined.
    const preview = await importFacilities(deps, body, { nationalSystem: SYSTEM });

    expect(preview.blocked).toBe(true);
    expect(preview.blockedReason).toBe('quarantined-rows');
    expect(preview).toMatchObject({ create: 0, unchanged: 1 });
  });

  it('refuses to apply a file with duplicate headers', async () => {
    const deps = await buildDeps();

    const result = await importFacilities(deps, 'national_code,name,name\n1,A,B\n', {
      nationalSystem: SYSTEM, apply: true, allowMalformedRows: true,
    });

    expect(result.written.created).toBe(0);
    expect(result.duplicateColumns).toEqual(['name']);
    // ⛔ THIS is what makes the duplicate-header clause of `blocked` observable at all. Nothing was
    // written either way — `parseFacilityCsv` returns `records: []` for a duplicate header, so the
    // `records.length === 0` fallback in the same condition already prevents the write — which is
    // why the two assertions above passed with the clause DELETED. `blocked`/`blockedReason` are
    // reported rather than inferred, so they distinguish "we refused this file" from "there was
    // nothing in it", and removing `duplicateColumns.length > 0` from the predicate fails here.
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toBe('duplicate-columns');
  });

  // The precedence the two consumers depend on, and the only place both reasons hold at once.
  // Constructed directly because `parseFacilityCsv` can never produce it: it returns early on a
  // duplicate header, before any row is examined, so `quarantined` is always empty in that result.
  // `'duplicate-columns'` must win — it has NO override, and reporting the overridable reason would
  // point an operator at `--allow-malformed-rows` / the sheet's checkbox, neither of which can
  // unblock the file.
  it('reports duplicate-columns rather than quarantined-rows when a caller could see both', async () => {
    const deps = await buildDeps();

    const result = await importFacilities(deps, 'national_code,name,name\n1,A,B\n2,C\n', {
      nationalSystem: SYSTEM, apply: true,
    });

    expect(result.duplicateColumns).toEqual(['name']);
    expect(result.blockedReason).toBe('duplicate-columns');
  });

  // A file the parser ACCEPTED and that has rows to write is not blocked — otherwise `blocked`
  // would be a constant and every consumer reading it would silently refuse every good import.
  it('is not blocked for a clean file', async () => {
    const deps = await buildDeps();

    const result = await importFacilities(deps, csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']), {
      nationalSystem: SYSTEM, apply: true,
    });

    expect(result).toMatchObject({ create: 1, written: { created: 1, updated: 0 }, blocked: false, blockedReason: null });
  });
});

// FAC-P1-03. The preview used to early-return `created: 0, updated: 0` before ever looking at the
// registry, and apply counted every existing row as `updated` whether or not anything about it
// changed — measured on real Postgres: re-importing a byte-identical 13 000-row national release
// reported `created: 0, updated: 13000`. These tests pin the two vocabularies the reshape
// introduced: `create`/`changed`/`unchanged`/`conflict` describe what the file WOULD do (computed on
// both paths), `written.created`/`written.updated` describe what a statement actually wrote.
describe('preview reports real database impact (FAC-P1-03)', () => {
  it('a dry run against an empty registry reports create, not zeros', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    const r = await importFacilities(deps, body, { nationalSystem: SYSTEM });
    expect(r).toMatchObject({ create: 1, changed: 0, unchanged: 0, written: { created: 0, updated: 0 } });
    expect(r.samples.create).toEqual([{ id: expect.any(String), nationalCode: '100', name: 'Dodoma Regional Referral' }]);
  });

  it('a dry run of a byte-identical re-import reports unchanged, not updated', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    const preview = await importFacilities(deps, body, { nationalSystem: SYSTEM });
    expect(preview).toMatchObject({ create: 0, changed: 0, unchanged: 1 });
  });

  it('an APPLY of a byte-identical re-import reports unchanged and updates nothing', async () => {
    const deps = await buildDeps();
    // Two rows, deliberately: "100" is the row under test and stays byte-identical across both
    // applies; "200" is renamed on the second apply so that call's `toWrite` is non-empty. A
    // single-row byte-identical body cannot exercise this: with only an unchanged row, `toWrite` is
    // ALWAYS empty, so `if (toWrite.length > 0)` at the write site (facility-import.ts) skips the
    // whole insert statement regardless of whether its `.map` reads off `toWrite` or off
    // `classified` — the exact mutation this test exists to catch would never even run. With "200"
    // present and changed, the guard opens, and a write that (wrongly) mapped over `classified`
    // instead of `toWrite` would carry the untouched "100" row along in the SAME statement.
    const body = csv([
      '100,Dodoma Regional Referral,,,,,,,,,,,,,,',
      '200,Muhimbili,,,,,,,,,,,,,,',
    ]);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    // The counted `written` object alone cannot distinguish "not written" from "written and
    // miscounted": both `toWrite` (correct) and `classified` (a regression) drive `written` off the
    // SAME filtered subset, so a bug that widens what actually gets written without widening what
    // gets counted would sail through a `written`-only assertion. `updated_at` is the one observable
    // outside `written` that a write touches regardless of how it gets counted — read it BEFORE the
    // second apply and assert it is byte-identical afterwards.
    const before = await rowFor(deps.db, '100');
    const updatedAtBefore = new Date(before!.updated_at).getTime();

    const renamed = csv([
      '100,Dodoma Regional Referral,,,,,,,,,,,,,,', // byte-identical
      '200,Muhimbili Renamed,,,,,,,,,,,,,,', // changed, so toWrite is non-empty this call
    ]);
    const again = await importFacilities(deps, renamed, { nationalSystem: SYSTEM, apply: true });
    expect(again).toMatchObject({ unchanged: 1, changed: 1, written: { created: 0, updated: 1 } });

    // ⚠ Compared as `.getTime()`, never as strings: `updated_at` is `timestamptz`, so the driver
    // returns a `Date` here even though `FacilityRegistryTable` declares the column `string`.
    const after = await rowFor(deps.db, '100');
    expect(new Date(after!.updated_at).getTime()).toBe(updatedAtBefore);
  });

  it('reports a rename as changed with its field diff', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Old Name,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const r = await importFacilities(deps, csv(['100,New Name,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.changed).toBe(1);
    expect(r.samples.changed[0].diff).toEqual([{ field: 'name', before: 'Old Name', after: 'New Name' }]);
  });

  it('reports conflict as null — NOT 0 — when no run links preview to apply', async () => {
    const deps = await buildDeps();
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.conflict).toBeNull();
  });

  // 🟠 Important 2. `previewedAt` is a public option and `opts.previewedAt` reaches
  // `classifyFacilityRows` on the APPLY path exactly the same as the preview path — so an apply CAN
  // classify a row `conflict`, and nothing pinned any of the three decisions `facility-import.ts`
  // makes about that row: it is excluded from `toWrite` (not written), excluded from `mergedRecords`
  // (not projected), and `conflict` is reported as a count on the result. Reachable by supplying a
  // `previewedAt` OLDER than the row's real `updated_at` — exactly what happens when an operator
  // previews, someone else's write lands, and the operator applies against the stale preview.
  it('an APPLY with a stale previewedAt reports the row as conflict, writes nothing, and leaves it untouched', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    const before = await rowFor(deps.db, '100');
    const updatedAtBefore = new Date(before!.updated_at).getTime();
    // A watermark strictly BEFORE the row's own `updated_at` — i.e. "the preview this apply claims
    // to follow was taken before this row was last touched" — is exactly what
    // `classifyFacilityRows` treats as `conflict` (facility-classify.ts: `existing.updatedAt >
    // watermark`).
    const stalePreviewedAt = new Date(updatedAtBefore - 1000);

    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    const result = await importFacilities(
      deps, renamed, { nationalSystem: SYSTEM, apply: true, previewedAt: stalePreviewedAt },
    );

    expect(result).toMatchObject({ conflict: 1, written: { created: 0, updated: 0 } });

    const after = await rowFor(deps.db, '100');
    expect(after?.name).toBe('Dodoma Regional Referral'); // NOT renamed — the conflicting write was skipped.
    expect(new Date(after!.updated_at).getTime()).toBe(updatedAtBefore); // untouched, not just unrenamed.
  });

  // A2a: the explicit overwrite override the design spec calls for ("the default is skip conflicts,
  // with an explicit overwrite option") — the mirror image of the skip test directly above. Same
  // stale-`previewedAt` setup, but `onConflict: 'overwrite'` this time: the row IS renamed, and
  // `conflict` still reports the count (the operator must be told how many rows they overwrote, not
  // have the count vanish the moment they act on it).
  it('an APPLY with onConflict: overwrite writes the conflicting row and still reports it as conflict', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    const before = await rowFor(deps.db, '100');
    const updatedAtBefore = new Date(before!.updated_at).getTime();
    const stalePreviewedAt = new Date(updatedAtBefore - 1000);

    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    const result = await importFacilities(
      deps, renamed,
      { nationalSystem: SYSTEM, apply: true, previewedAt: stalePreviewedAt, onConflict: 'overwrite' },
    );

    expect(result).toMatchObject({ conflict: 1, written: { created: 0, updated: 1 } });

    const after = await rowFor(deps.db, '100');
    expect(after?.name).toBe('Dodoma Regional Referral Hospital'); // renamed — the overwrite went through.
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(updatedAtBefore); // actually touched.
  });

  it('reports absent as null — NOT 0 — when the release is not declared complete', async () => {
    const deps = await buildDeps();
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.absent).toBeNull();
  });

  it('excludes invalid-coordinate rows from the write and reports them', async () => {
    const deps = await buildDeps();
    const r = await importFacilities(
      deps, csv(['100,Alpha,,,,,,,,,,,,,91,35']), { nationalSystem: SYSTEM, apply: true });
    expect(r.invalid).toHaveLength(1);
    expect(r.create).toBe(0);
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });
});

// Fix 1 (mapping-ux report): a bulk-imported register must be mappable immediately too — the same
// requirement as a single facility create/update, applied to the CSV path shared by the CLI and the
// Facilities-page upload.
describe('importFacilities projects into FACILITY_REGISTRY_SYSTEM', () => {
  async function buildDepsWithAdmin(): Promise<FacilityImportDeps & { db: Kysely<InternalSchema>; admin: TerminologyAdminStore }> {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    return { db, capture: referenceCapture, admin: createTerminologyAdminStore(db) };
  }

  it('an applied import makes every imported row pickable as a mapping target, with no separate publish step', async () => {
    const deps = await buildDepsWithAdmin();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,', '101,Kongwa DDH,,,,,,,,,,,,,,']);

    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.display).sort()).toEqual(['Dodoma Regional Referral', 'Kongwa DDH']);
  });

  it('a dry run projects nothing', async () => {
    const deps = await buildDepsWithAdmin();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);

    await importFacilities(deps, body, { nationalSystem: SYSTEM });

    const { total } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });

  it('omitting admin skips projection without failing the import', async () => {
    const deps = await buildDeps(); // no `admin` in deps
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);

    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    expect(result).toMatchObject({ written: { created: 1, updated: 0 } });
    expect(await rowFor(deps.db, '100')).toBeDefined();
  });
});

// Task 5: an applied import leaves the report-facing `facility_map` dimension stale, same as a
// single create/update/delete through the Facilities page (apps/server/src/facilities-routes.ts).
// `facilityJobs` is an OPTIONAL dep on `FacilityImportDeps`, mirroring `admin`/`capture` above, so the
// CLI and any existing caller that omits it keeps working unchanged.
describe('importFacilities enqueues a facility-map-rebuild', () => {
  async function buildDepsWithJobs(): Promise<FacilityImportDeps & { db: Kysely<InternalSchema>; facilityJobs: FacilityJobStore }> {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    return { db, capture: referenceCapture, facilityJobs: createFacilityJobStore(db) };
  }

  // ⛔ The load-bearing assertion of this whole task. `importFacilities` calls `enqueue` once per
  // import (after the whole batch write commits), not once per row — proven at implementation
  // time by temporarily making it call `enqueue` once per row instead: with the real store's
  // coalescing (facility-job-store.ts's `activeKeyFor`) intact this assertion still held (only the
  // first of 50 calls finds the identity free), and disabling that coalescing made it fail with 50
  // jobs. So this assertion holds for TWO independent reasons — the call site's own shape AND the
  // store's coalescing underneath it — and would catch a regression in either one.
  it('a CSV import of many facilities enqueues exactly ONE rebuild', async () => {
    const deps = await buildDepsWithJobs();
    const rows = Array.from({ length: 50 }, (_, i) => `${100 + i},Facility ${i},,,,,,,,,,,,,,`);

    await importFacilities(deps, csv(rows), { nationalSystem: SYSTEM, apply: true });

    const rebuilds = (await deps.facilityJobs.listUnresolved()).filter((j) => j.kind === 'facility-map-rebuild');
    expect(rebuilds).toHaveLength(1);
  });

  it('a dry run does not enqueue a rebuild — nothing changed for the dimension to catch up to', async () => {
    const deps = await buildDepsWithJobs();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);

    await importFacilities(deps, body, { nationalSystem: SYSTEM }); // apply omitted

    expect(await deps.facilityJobs.listUnresolved()).toEqual([]);
  });

  it('omitting facilityJobs does not fail the import', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);

    const result = await importFacilities({ db }, body, { nationalSystem: SYSTEM, apply: true }); // no facilityJobs in deps

    expect(result).toMatchObject({ written: { created: 1, updated: 0 } });
    expect(await rowFor(db, '100')).toBeDefined();
  });

  // ⛔ This enqueue sits AFTER the import transaction has committed, so an uncontained throw here
  // fails a write that already happened: the HTTP route rethrows whatever this raises (500 for a
  // successful import) and, because its `facility.import` audit is written after the call returns,
  // the audit record of that write is skipped too. Every other enqueue call site on this slice —
  // three in facilities-routes.ts, three in terminology-admin-routes.ts — is wrapped for exactly
  // this reason; this one was the only bare one.
  it('a throwing enqueue does not fail an import that already committed, and is reported', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const errors: unknown[] = [];
    const deps: FacilityImportDeps = {
      db, capture: referenceCapture,
      facilityJobs: {
        ...createFacilityJobStore(db),
        enqueue: async () => { throw new Error('job store unreachable'); },
      },
      logger: { error: (obj) => { errors.push(obj); } },
    };
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);

    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    expect(result).toMatchObject({ written: { created: 1, updated: 0 } });
    // The row really is written — the failure must not be mistaken for a rolled-back import.
    expect(await rowFor(db, '100')).toBeDefined();
    // Contained, but NOT swallowed: a lost enqueue leaves the dimension stale, and this log line is
    // the only thing that records it.
    expect(errors).toHaveLength(1);
    expect(String((errors[0] as { err: Error }).err.message)).toMatch(/job store unreachable/);
  });
});

describe('absent and deleted rows', () => {
  it('reports absent as null when the release is not declared complete', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.absent).toBeNull();
  });

  it('counts absent rows when the release IS declared complete', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, completeRelease: true });
    expect(r.absent).toBe(1);
    expect(r.samples.absent).toEqual([{ id: expect.any(String), nationalCode: '200', name: 'Beta' }]);
  });

  it('does NOT retire an absent row by default, even on apply', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true, completeRelease: true });
    const beta = await rowFor(deps.db, '200');
    expect(beta?.status).toBeNull();
  });

  it('retires an absent row to `inactive` when the operator asks', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), {
      nationalSystem: SYSTEM, apply: true, completeRelease: true, onAbsent: 'retire',
    });
    const beta = await rowFor(deps.db, '200');
    expect(beta?.status).toBe('inactive');
  });

  it('never deletes a row, whatever the policy', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), {
      nationalSystem: SYSTEM, apply: true, completeRelease: true, onAbsent: 'retire',
    });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(2);
  });

  it('scopes absence to this national_system only', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['999,Other Register,,,,,,,,,,,,,,']), { nationalSystem: 'urn:other', apply: true });
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, completeRelease: true });
    expect(r.absent).toBe(0);
  });
});

// Task 9's wiring gap (not in the original plan, see the brief): `format: 'jsonl'` dispatches to
// `parseFacilityRelease` instead of `parseFacilityCsv`, and its `deletions` — national codes the
// publisher explicitly declared removed — is what `result.deleted` and `onDeleted` actually consume.
// None of this has coverage from the brief's own test list (which is CSV-only throughout), so it is
// covered here instead.
describe('format: "jsonl" and declared deletions', () => {
  it('imports a JSONL release when format is "jsonl"', async () => {
    const deps = await buildDeps();
    const body = jsonl([rowLine('100', 'Alpha')]);
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, format: 'jsonl', apply: true });
    expect(result.written).toEqual({ created: 1, updated: 0 });
    expect(await rowFor(deps.db, '100')).toBeDefined();
  });

  it('retires a row the publisher declared deleted, by default — even from a deletions-only release with no ordinary rows at all', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const body = jsonl([deletionLine('100')]); // no `type:"row"` line in this file
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, format: 'jsonl', apply: true });
    expect(result.deleted).toBe(1);
    expect(result.samples.deleted).toEqual([{ id: expect.any(String), nationalCode: '100', name: 'Alpha' }]);
    const alpha = await rowFor(deps.db, '100');
    expect(alpha?.status).toBe('inactive');
  });

  it('does not count a declared deletion for a facility this registry never had', async () => {
    const deps = await buildDeps();
    const body = jsonl([deletionLine('999')]);
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, format: 'jsonl', apply: true });
    expect(result.deleted).toBe(0);
    expect(result.samples.deleted).toEqual([]);
  });

  it('reports a declared deletion without retiring when onDeleted is "report"', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const body = jsonl([deletionLine('100')]);
    const result = await importFacilities(deps, body, {
      nationalSystem: SYSTEM, format: 'jsonl', apply: true, onDeleted: 'report',
    });
    expect(result.deleted).toBe(1);
    const alpha = await rowFor(deps.db, '100');
    expect(alpha?.status).toBeNull();
  });

  it('never counts a declared deletion as an inferred absence too — the two buckets stay disjoint', async () => {
    const deps = await buildDeps();
    await importFacilities(
      deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true },
    );
    const body = jsonl([rowLine('100', 'Alpha'), deletionLine('200')]);
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, format: 'jsonl', completeRelease: true });
    expect(result.deleted).toBe(1);
    // Without the exclusion in importFacilities' absent computation, Beta (declared deleted, and
    // therefore absent from this file's ordinary rows) would ALSO satisfy "not in ids" and double-
    // report as an INFERRED absence — contradicting the fact the publisher already stated outright.
    expect(result.absent).toBe(0);
  });
});
