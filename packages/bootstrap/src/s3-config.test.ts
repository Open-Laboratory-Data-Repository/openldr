import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import type { Config } from '@openldr/config';
import { createBlobFromConfig, toS3BucketConfig } from './s3-config';

describe('toS3BucketConfig', () => {
  it('maps the S3_* config fields onto S3BucketConfig', () => {
    const cfg = { S3_ENDPOINT: 'http://minio:9000', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'ak', S3_SECRET_ACCESS_KEY: 'sk', S3_BUCKET: 'openldr', S3_FORCE_PATH_STYLE: true } as never;
    expect(toS3BucketConfig(cfg)).toEqual({ endpoint: 'http://minio:9000', region: 'us-east-1', accessKeyId: 'ak', secretAccessKey: 'sk', bucket: 'openldr', forcePathStyle: true });
  });
  it('throws under fs', () => {
    expect(() => toS3BucketConfig({ BLOB_ADAPTER: 'fs', BLOB_DIR: '/tmp/x' } as Config))
      .toThrow('S3 settings are not set: BLOB_ADAPTER is fs');
  });
});

describe('createBlobFromConfig', () => {
  const cfg = {
    BLOB_ADAPTER: 'minio', S3_ENDPOINT: 'http://127.0.0.1:9499', S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'x', S3_SECRET_ACCESS_KEY: 'xxxxxxxx', S3_BUCKET: 'none', S3_FORCE_PATH_STYLE: true,
  } as Config;
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'blob-config-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('builds the file adapter under fs', async () => {
    const blob = createBlobFromConfig({ ...cfg, BLOB_ADAPTER: 'fs', BLOB_DIR: tmp });
    await blob.put('a/b', 'x');
    expect(new TextDecoder().decode(await blob.get('a/b'))).toBe('x');
  });
  it('builds the S3 adapter under minio', async () => {
    const blob = createBlobFromConfig(cfg);
    expect(typeof blob.healthCheck).toBe('function');
    // Signing a URL needs no network. Only the S3 adapter can do it, and the URL names the endpoint.
    expect(await blob.presign('a/b')).toContain('http://127.0.0.1:9499/none/a/b');
  });
});
