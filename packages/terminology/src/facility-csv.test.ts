import { describe, it, expect } from 'vitest';
import { parseFacilityCsv, FACILITY_CSV_TEMPLATE } from './facility-csv';

const HFR = 'urn:tz:hfr';
const csv = (body: string) => parseFacilityCsv(body, { nationalSystem: HFR });

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

  it('counts a ragged row as skipped instead of throwing, and still imports the good rows', () => {
    // csv-parse throws "Invalid Record Length" on a row whose field count differs from the header
    // unless relax_column_count is set. A single malformed line must not reject the whole file.
    const r = csv(
      'national_code,name,level\n' +
      '122023-5,BAHEBE,Level IA2\n' +
      'TOOFEW\n' +
      '999-9,GOOD ROW,Level IB\n',
    );
    expect(r.records.map((rec) => rec.nationalCode)).toEqual(['122023-5', '999-9']);
    expect(r.skipped).toBe(1);
  });
});
