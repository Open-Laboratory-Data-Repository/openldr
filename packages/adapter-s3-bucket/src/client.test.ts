import { describe, it, expect } from 'vitest';
import { createS3Client } from './client';

const cfg = {
  endpoint: 'http://localhost:9010',
  region: 'us-east-1',
  accessKeyId: 'GK6f70656e6c64722d64657621',
  secretAccessKey: 'x'.repeat(64),
  bucket: 'openldr',
  forcePathStyle: true,
};

describe('createS3Client', () => {
  // Garage stores a multipart object's CRC32 as a checksum of the part checksums but does not
  // mark it as one. The SDK's default (WHEN_SUPPORTED) validates it as a whole-object checksum
  // and throws "Checksum mismatch" on every read of an upload over 5 MB. Measured 2026-10-09
  // against Garage v2.4.1 and @aws-sdk/client-s3 3.1066.0.
  it('only calculates request checksums when the operation requires one', async () => {
    const client = createS3Client(cfg);
    expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED');
  });

  it('only validates response checksums when the operation requires it', async () => {
    const client = createS3Client(cfg);
    expect(await client.config.responseChecksumValidation()).toBe('WHEN_REQUIRED');
  });

  it('keeps path-style addressing from config', () => {
    expect(createS3Client(cfg).config.forcePathStyle).toBe(true);
  });
});
