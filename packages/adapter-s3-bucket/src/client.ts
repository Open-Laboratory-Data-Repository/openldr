import { S3Client } from '@aws-sdk/client-s3';

export interface S3BucketConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

/** One S3 client shape for every caller, so the checksum settings cannot drift between them.
 *
 *  WHEN_REQUIRED on both sides is the SDK's behaviour before 3.729. Garage returns a multipart
 *  object's CRC32 as a checksum of part checksums without marking it, and the newer default
 *  validates that as a whole-object checksum and throws on every read. AWS and MinIO work the
 *  same under either setting. */
export function createS3Client(cfg: S3BucketConfig): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
