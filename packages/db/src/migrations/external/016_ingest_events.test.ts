import { describe, it, expect } from 'vitest';
import { shortKeyType, keyType } from './dialect';

describe('016 ingest_events — dialect widths', () => {
  it('keeps the composite primary key inside MSSQL\'s 900-byte clustered key cap', () => {
    // keyType('mssql') is varchar(450); TWO of them are already exactly 900 (012_facility_map.ts:14).
    // The PK here is (resource_type, resource_id, version) — three columns — so resource_type must
    // be narrow or the table cannot be created on SQL Server at all.
    const resourceType = Number(shortKeyType('mssql').match(/\((\d+)\)/)![1]);
    const resourceId = Number(keyType('mssql').match(/\((\d+)\)/)![1]);
    const bigintBytes = 8;
    expect(resourceType + resourceId + bigintBytes).toBeLessThanOrEqual(900);
  });

  it('is narrow enough on MySQL too, where a utf8mb4 index caps at 3072 bytes', () => {
    const resourceType = Number(shortKeyType('mysql').match(/\((\d+)\)/)![1]);
    const resourceId = Number(keyType('mysql').match(/\((\d+)\)/)![1]);
    expect((resourceType + resourceId) * 4 + 8).toBeLessThanOrEqual(3072);
  });

  it('is a plain text type on Postgres, which has no such cap', () => {
    expect(shortKeyType('postgres')).toBe('text');
  });
});
