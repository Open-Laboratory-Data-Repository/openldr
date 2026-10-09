import { ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import { createS3Client, type S3BucketConfig } from './client';

export interface StoredObject { key: string; size: number }

export interface CopySide {
  list(): AsyncIterable<StoredObject>;
  sizeOf(key: string): Promise<number | null>;
  read(key: string): Promise<{ body: Readable; contentType?: string }>;
  write(key: string, body: Readable, contentType?: string): Promise<void>;
}

/** The four operations a bucket-to-bucket copy needs, over one bucket. Kept apart from
 *  BlobStoragePort because only the one-off MinIO to Garage move lists a whole bucket. */
export function createS3CopySide(cfg: S3BucketConfig, deps: { client?: S3Client } = {}): CopySide {
  const client = deps.client ?? createS3Client(cfg);
  return {
    async *list() {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: cfg.bucket, ContinuationToken: token }),
        );
        for (const o of page.Contents ?? []) {
          if (o.Key !== undefined) yield { key: o.Key, size: o.Size ?? 0 };
        }
        token = page.NextContinuationToken;
      } while (token);
    },
    async sizeOf(key) {
      try {
        const h = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return h.ContentLength ?? 0;
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
          return null;
        }
        throw err;
      }
    },
    async read(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const body = res.Body as Readable | undefined;
      if (!body) throw new Error(`empty object: ${key}`);
      return { body, contentType: res.ContentType };
    },
    async write(key, body, contentType) {
      await new Upload({
        client,
        params: { Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType },
      }).done();
    },
  };
}
