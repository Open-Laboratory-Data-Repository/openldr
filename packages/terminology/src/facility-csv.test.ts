import { describe, it, expect } from 'vitest';
import { parseFacilityCsv, FACILITY_CSV_TEMPLATE } from './facility-csv';

const HFR = 'urn:tz:hfr';
const csv = (body: string) => parseFacilityCsv(body, { nationalSystem: HFR });
const opts = { nationalSystem: HFR };

describe('parseFacilityCsv', () => {
  it('parses the documented column contract into records', () => {
    const r = csv(
      'national_code,name,level,region,council,ward,ownership,status\n' +
      '122023-5,BAHEBE HEALTH LABORATORY,Level IA2 (Dispensary Laboratory),Geita,Chato DC,Nyamirembe,Private For Profit,Operating\n',
    );
    expect(r.unknownColumns).toEqual([]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      nationalSystem: HFR,
      nationalCode: '122023-5',
      name: 'BAHEBE HEALTH LABORATORY',
      level: 'Level IA2 (Dispensary Laboratory)',
      region: 'Geita',
      council: 'Chato DC',
      ward: 'Nyamirembe',
      status: 'Operating',
      source: 'import',
    });
  });

  it('gives an imported row NO local code — a national register has no concept of one', () => {
    const r = csv('national_code,name\n122023-5,BAHEBE\n');
    expect(r.records[0].localCode).toBeUndefined();
  });

  it('⛔ REPORTS unknown columns and yields NO records, rather than silently dropping them', () => {
    // This is the whole reason the rule exists: parseTermsCsv's docblock claims extra columns reach
    // properties while the code keeps three and discards the rest, so an import "succeeds" having
    // lost half the data. A silent success that lost data is the worst outcome available.
    const r = csv('national_code,name,favourite_colour,mystery\n122023-5,BAHEBE,blue,x\n');
    expect(r.unknownColumns).toEqual(['favourite_colour', 'mystery']);
    expect(r.records).toEqual([]);
  });

  it('imports anyway when unknown columns are explicitly allowed, keeping them in extras', () => {
    const r = parseFacilityCsv('national_code,name,favourite_colour\n122023-5,BAHEBE,blue\n', {
      nationalSystem: HFR, allowUnknownColumns: true,
    });
    expect(r.unknownColumns).toEqual(['favourite_colour']);
    expect(r.records[0].extras).toEqual({ favourite_colour: 'blue' });
  });

  it('skips rows missing a required field and counts them, rather than failing the whole file', () => {
    const r = csv('national_code,name\n122023-5,BAHEBE\n,NO CODE\n999-9,\n');
    expect(r.records).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });

  it('parses coordinates as numbers and leaves blanks null', () => {
    const r = csv('national_code,name,latitude,longitude\n122023-5,BAHEBE,-2.6,32.1\n120264-7,MATONDO,,\n');
    expect(r.records[0]).toMatchObject({ latitude: -2.6, longitude: 32.1 });
    expect(r.records[1].latitude).toBeNull();
  });

  it('generates a stable id from the national system and code, so re-import updates in place', () => {
    const a = csv('national_code,name\n122023-5,BAHEBE\n').records[0];
    const b = csv('national_code,name\n122023-5,BAHEBE RENAMED\n').records[0];
    expect(a.id).toBe(b.id);
  });

  it('exposes a template whose header matches what the parser accepts', () => {
    const r = parseFacilityCsv(FACILITY_CSV_TEMPLATE, { nationalSystem: HFR });
    expect(r.unknownColumns).toEqual([]);
  });

  it('stamps NO managedOrigin on an imported record — that is the sync applier\'s job, not the parser\'s', () => {
    // Migration 048's convention: managed_origin = 'central' is written by whoever RECEIVES a sync
    // payload, so the down-sync delete guard (`WHERE managed_origin = 'central'`) never touches a
    // lab's own authored rows. A CSV import is authoring, not receiving — stamping it here would let
    // central delete a lab's freshly-imported facilities.
    const r = csv('national_code,name\n122023-5,BAHEBE\n');
    expect(r.records[0].managedOrigin).toBeUndefined();
  });

  it('parses a UTF-8 BOM-prefixed file — the default export from Excel and most government tools', () => {
    const r = csv('﻿national_code,name\n122023-5,BAHEBE\n');
    expect(r.unknownColumns).toEqual([]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ nationalCode: '122023-5', name: 'BAHEBE' });
  });

  it('accepts uppercase/mixed-case headers', () => {
    const r = csv('NATIONAL_CODE,NAME\n122023-5,BAHEBE\n');
    expect(r.unknownColumns).toEqual([]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ nationalCode: '122023-5', name: 'BAHEBE' });
  });

  it('BOM detection on a header-only file (no data rows) matches the same-file-with-data path', () => {
    const r = csv('﻿national_code,name\n');
    expect(r.unknownColumns).toEqual([]);
  });

  it('quarantines a ragged row instead of shifting it into the wrong columns, and still imports the good rows', () => {
    // Was: csv-parse's relax_column_count padded/shifted a short row into place and it silently
    // imported. That is the exact defect this slice fixes — the row must now be quarantined, not
    // counted as `skipped` (which means something else: a well-formed row missing a required field).
    const r = csv(
      'national_code,name,level\n' +
      '122023-5,BAHEBE,Level IA2\n' +
      'TOOFEW\n' +
      '999-9,GOOD ROW,Level IB\n',
    );
    expect(r.records.map((rec) => rec.nationalCode)).toEqual(['122023-5', '999-9']);
    expect(r.skipped).toBe(0);
    expect(r.quarantined).toEqual([{ line: 3, raw: 'TOOFEW', reason: 'too_few_fields' }]);
  });

  it('quarantines a row with an unescaped comma instead of shifting values into the wrong columns', () => {
    // The audit's exact reproduction. Before this fix relax_column_count accepted the row and mapped
    // level:'East', region:'Hospital', silently dropping 'Dodoma'.
    const csvText = 'national_code,name,level,region\n1,Clinic, East,Hospital,Dodoma\n';

    const r = parseFacilityCsv(csvText, opts);

    expect(r.records).toEqual([]);
    expect(r.quarantined).toEqual([
      { line: 2, raw: '1,Clinic, East,Hospital,Dodoma', reason: 'too_many_fields' },
    ]);
  });

  it('quarantines a row with too few fields', () => {
    const csvText = 'national_code,name,level,region\n1,Clinic\n';
    const r = parseFacilityCsv(csvText, opts);
    expect(r.records).toEqual([]);
    expect(r.quarantined).toEqual([{ line: 2, raw: '1,Clinic', reason: 'too_few_fields' }]);
  });

  it('never throws on a ragged row — one bad row must not kill a national import', () => {
    const csvText = 'national_code,name\n1,Good\n2,Bad,Extra\n3,AlsoGood\n';
    const r = parseFacilityCsv(csvText, opts);
    expect(r.records.map((x) => x.nationalCode)).toEqual(['1', '3']);
    expect(r.quarantined).toHaveLength(1);
    expect(r.quarantined[0].line).toBe(3);
  });

  it('accepts a quoted comma and a quoted multiline name as WELL-FORMED', () => {
    const csvText = 'national_code,name\n1,"St. Mary, Annex"\n2,"Line\nTwo"\n';
    const r = parseFacilityCsv(csvText, opts);
    expect(r.quarantined).toEqual([]);
    expect(r.records.map((x) => x.name)).toEqual(['St. Mary, Annex', 'Line\nTwo']);
  });

  it('handles CRLF line endings without quarantining every row', () => {
    const csvText = 'national_code,name\r\n1,Clinic\r\n2,Other\r\n';
    const r = parseFacilityCsv(csvText, opts);
    expect(r.quarantined).toEqual([]);
    expect(r.records).toHaveLength(2);
  });

  it('reports a duplicate header as an unknown-column style failure rather than mapping it twice', () => {
    const csvText = 'national_code,name,name\n1,A,B\n';
    const r = parseFacilityCsv(csvText, opts);
    expect(r.records).toEqual([]);
    expect(r.duplicateColumns).toEqual(['name']);
  });
});

describe('parseFacilityCsv with a column map', () => {
  const map = {
    columns: { 'MFL Code': 'national_code', Name: 'name', Province: 'zone', Type: 'level' },
    constants: { country: 'ZMB' },
    extras: ['DHIS2 UID'],
  };

  it('renames headers, applies constants, and carries opted-in columns to extras', () => {
    const r = parseFacilityCsv(
      'MFL Code,Name,Province,Type,DHIS2 UID\n1835,Namatindi RHC,Western,Health Centre,fykM10MbEBA\n',
      { nationalSystem: HFR, columnMap: map },
    );
    expect(r.columnMapErrors).toEqual([]);
    expect(r.unknownColumns).toEqual([]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      nationalCode: '1835', name: 'Namatindi RHC', zone: 'Western',
      level: 'Health Centre', country: 'ZMB',
    });
    // extras keys stay lowercased — existing behaviour, see facility-csv.ts:205
    expect(r.records[0].extras).toEqual({ 'dhis2 uid': 'fykM10MbEBA' });
  });

  it('matches map keys case-insensitively against the file header', () => {
    const r = parseFacilityCsv('mfl code,name\n1835,Namatindi RHC\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name' } },
    });
    expect(r.columnMapErrors).toEqual([]);
    expect(r.records[0].nationalCode).toBe('1835');
  });

  it('⛔ refuses a header in neither columns nor extras, exactly as an unknown column today', () => {
    const r = parseFacilityCsv('MFL Code,Name,Surprise\n1835,X,y\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name' } },
    });
    expect(r.unknownColumns).toEqual(['surprise']);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses two headers mapped to the same field, reporting both', () => {
    const r = parseFacilityCsv('A,B,Name\n1,2,X\n', {
      nationalSystem: HFR,
      columnMap: { columns: { A: 'national_code', B: 'national_code', Name: 'name' } },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'duplicate_target', subject: 'B', target: 'national_code', other: 'A' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses a constant that collides with a mapped column', () => {
    const r = parseFacilityCsv('MFL Code,Name,Country\n1,X,Zambia\n', {
      nationalSystem: HFR,
      columnMap: {
        columns: { 'MFL Code': 'national_code', Name: 'name', Country: 'country' },
        constants: { country: 'ZMB' },
      },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'constant_collision', subject: 'country', target: 'country', other: 'Country' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses a target outside the contract', () => {
    const r = parseFacilityCsv('MFL Code,Name\n1,X\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name', Nope: 'password' } },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'unknown_target', subject: 'Nope', target: 'password' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses when a required field is neither mapped nor constant', () => {
    const r = parseFacilityCsv('MFL Code\n1835\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code' } },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'missing_required', subject: 'name', target: 'name' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('reports EVERY map problem at once, so one fix pass repairs the file', () => {
    const r = parseFacilityCsv('A,B\n1,2\n', {
      nationalSystem: HFR,
      columnMap: { columns: { A: 'national_code', B: 'national_code' } },
    });
    expect(r.columnMapErrors.map((e) => e.reason).sort())
      .toEqual(['duplicate_target', 'missing_required']);
  });

  it('leaves behaviour identical when no column map is supplied', () => {
    const r = csv('national_code,name\n122023-5,BAHEBE\n');
    expect(r.columnMapErrors).toEqual([]);
    expect(r.records[0].nationalCode).toBe('122023-5');
  });
});

describe('coordinate validation', () => {
  const H = 'national_code,name,latitude,longitude';
  const parse = (rows: string[]) => parseFacilityCsv([H, ...rows].join('\n') + '\n', { nationalSystem: 'S' });

  it('rejects a non-numeric coordinate with a row error instead of silently nulling it', () => {
    const r = parse(['1,Alpha,N/A,35.0']);
    expect(r.records).toHaveLength(0);
    expect(r.invalid).toEqual([{ line: 2, field: 'latitude', reason: 'not_a_number', raw: 'N/A' }]);
  });

  it('rejects an out-of-range latitude', () => {
    const r = parse(['1,Alpha,91,35.0']);
    expect(r.invalid).toEqual([{ line: 2, field: 'latitude', reason: 'out_of_range', raw: '91' }]);
  });

  it('rejects an out-of-range longitude', () => {
    const r = parse(['1,Alpha,-2.4,181']);
    expect(r.invalid).toEqual([{ line: 2, field: 'longitude', reason: 'out_of_range', raw: '181' }]);
  });

  it('rejects half a coordinate pair', () => {
    const r = parse(['1,Alpha,-2.4,']);
    expect(r.invalid).toEqual([{ line: 2, field: 'longitude', reason: 'incomplete_pair', raw: '' }]);
  });

  it('accepts both coordinates absent, and accepts the boundary values', () => {
    expect(parse(['1,Alpha,,']).invalid).toEqual([]);
    expect(parse(['1,Alpha,,']).records).toHaveLength(1);
    expect(parse(['2,Beta,-90,-180']).invalid).toEqual([]);
    expect(parse(['3,Gamma,90,180']).invalid).toEqual([]);
  });

  // 🟠 Important 2: the escape hatch the design spec mandates ("an explicit override in the same
  // idiom as allowUnknownColumns/allowMalformedRows"). Without it a national register carrying
  // `latitude: "N/A"` loses the FACILITY, not just its coordinate.
  describe('allowInvalidCoordinates', () => {
    const parseAllowing = (rows: string[]) =>
      parseFacilityCsv([H, ...rows].join('\n') + '\n', { nationalSystem: 'S', allowInvalidCoordinates: true });

    it('imports the row with both coordinates null and still reports the error', () => {
      const r = parseAllowing(['1,Alpha,N/A,35.0']);
      expect(r.records).toHaveLength(1);
      expect(r.records[0].latitude).toBeNull();
      // ⛔ The parseable half goes to null TOO — half a coordinate is not a location, so keeping
      // 35.0 would write a position the file never expressed.
      expect(r.records[0].longitude).toBeNull();
      // Reporting is unconditional: the flag decides whether the row is DROPPED, not whether its
      // errors are surfaced.
      expect(r.invalid).toEqual([{ line: 2, field: 'latitude', reason: 'not_a_number', raw: 'N/A' }]);
    });

    it('applies to an out-of-range value and to half a pair alike', () => {
      expect(parseAllowing(['1,Alpha,91,35']).records).toHaveLength(1);
      const half = parseAllowing(['1,Alpha,-2.4,']);
      expect(half.records).toHaveLength(1);
      expect(half.records[0].latitude).toBeNull();
      expect(half.invalid).toHaveLength(1);
    });

    it('changes nothing about a row whose coordinates are valid or absent', () => {
      expect(parseAllowing(['1,Alpha,-2.4,35']).records[0].latitude).toBe(-2.4);
      expect(parseAllowing(['2,Beta,,']).records[0].latitude).toBeNull();
      expect(parseAllowing(['3,Gamma,-2.4,35']).invalid).toEqual([]);
    });
  });
});
