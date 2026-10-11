import type { S3Client } from '@aws-sdk/client-s3';
import {
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { probe } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { Readable } from 'node:stream';
import { createS3Client } from './client';
import type { S3BucketConfig } from './client';

export type { S3BucketConfig } from './client';
export { createS3Client } from './client';

export { createS3CopySide, type CopySide, type StoredObject } from './copy';

export interface S3BucketDeps {
  client?: S3Client;
}

export function createS3Bucket(cfg: S3BucketConfig, deps: S3BucketDeps = {}): BlobStoragePort {
  const client = deps.client ?? createS3Client(cfg);

  return {
    async healthCheck() {
      return probe(async () => {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
        return `bucket ${cfg.bucket} reachable`;
      });
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async putStream(key, body, contentType) {
      // Upload handles multipart automatically for large bodies and a single PutObject for small ones,
      // so the whole object is never buffered in memory.
      const upload = new Upload({
        client,
        params: { Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType },
      });
      await upload.done();
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error(`empty object: ${key}`);
      return bytes;
    },
    async getStream(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const stream = res.Body as Readable | undefined;
      if (!stream) throw new Error(`empty object: ${key}`);
      return stream;
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return true;
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw err; // propagate credential / permission / network errors instead of masking them
      }
    },
    async presign(key, expiresInSeconds = 900) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
  };
}
