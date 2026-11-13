import type { Config } from '@openldr/config';
import { createS3Bucket, type S3BucketConfig } from '@openldr/adapter-s3-bucket';
import { createFsBucket } from '@openldr/adapter-fs-bucket';
import type { BlobStoragePort } from '@openldr/ports';

function requiredSetting(name: string, value: string | undefined): string {
  // The config schema already requires these for the chosen adapter. This guards a Config built by hand.
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

export function toS3BucketConfig(cfg: Config): S3BucketConfig {
  if (cfg.BLOB_ADAPTER === 'fs') throw new Error('S3 settings are not set: BLOB_ADAPTER is fs');
  return {
    endpoint: requiredSetting('S3_ENDPOINT', cfg.S3_ENDPOINT),
    region: cfg.S3_REGION,
    accessKeyId: requiredSetting('S3_ACCESS_KEY_ID', cfg.S3_ACCESS_KEY_ID),
    secretAccessKey: requiredSetting('S3_SECRET_ACCESS_KEY', cfg.S3_SECRET_ACCESS_KEY),
    bucket: requiredSetting('S3_BUCKET', cfg.S3_BUCKET),
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  };
}

/** The one place that picks the storage adapter from config. */
export function createBlobFromConfig(cfg: Config): BlobStoragePort {
  if (cfg.BLOB_ADAPTER === 'fs') return createFsBucket({ dir: requiredSetting('BLOB_DIR', cfg.BLOB_DIR) });
  return createS3Bucket(toS3BucketConfig(cfg));
}
