# Third-party images and Garage storage: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installs pull third-party images only from our GHCR copies, MinIO is replaced by a
Garage `storage` service, and existing installs can move their objects with
`openldr storage copy`.

**Architecture:** A committed list (`deploy/third-party-images.json`) names every third-party image
and its digest-pinned GHCR copy. A test in `@openldr/release` fails on any compose or Dockerfile
reference outside that list. Garage runs as a single node that creates its own key and bucket from
env vars. The S3 adapter gains a checksum setting Garage needs and a small copy interface, and
`@openldr/bootstrap` holds the copy logic the CLI calls.

**Tech Stack:** TypeScript, vitest, `@aws-sdk/client-s3` 3.1066.0, commander (CLI), docker
buildx imagetools, Garage v2.4.1, bash and PowerShell installers.

**Spec:** `docs/superpowers/specs/2026-10-09-third-party-images-and-garage-storage-design.md`

## Global constraints

- Work only in `.claude/worktrees/garage-storage` on branch `feat/garage-storage`. Before every
  command batch: `cd /d/Projects/Repositories/openldr_ce/.claude/worktrees/garage-storage && git branch --show-current`
  must print `feat/garage-storage`.
- GHCR org path: `ghcr.io/open-laboratory-data-repository`. GitHub owner for API calls:
  `Open-Laboratory-Data-Repository`.
- Garage: upstream `dxflrs/garage:v2.4.1`. Key ID is `GK` + 24 lowercase hex. Secret, RPC secret
  and admin token are 64 lowercase hex each.
- Garage S3 port 3900, health check `["CMD", "/garage", "status"]`, config at `/etc/garage.toml`,
  data under `/var/lib/garage`.
- `s3_region = "us-east-1"`. `S3_REGION` stays `us-east-1` everywhere.
- Compose service name is `storage`. Volume name is `storagedata`.
- SQL Server image stays on `mcr.microsoft.com` as a listed exception.
- The dev compose (`docker-compose.yml`) is outside the image policy. It only gets the `storage` swap.
- Dev-only fixed values (never used by an installer):
  - `S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621`
  - `S3_SECRET_ACCESS_KEY=6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031`
  - `GARAGE_RPC_SECRET=6465762d6f6e6c792d6761726167652d7270632d7365637265742d3030303031`
  - `GARAGE_ADMIN_TOKEN=6465762d6f6e6c792d6761726167652d61646d696e2d746f6b656e2d30303031`
- No em dashes in anything written. Run the `unslop` rules over docs and commit messages.
- Never add a `Co-Authored-By` trailer.
- Git Bash rewrites leading-slash args. Prefix `docker run ... /garage ...` and
  `docker compose exec ...` with `MSYS_NO_PATHCONV=1`.
- Full gate, both forced, at concurrency 2:
  `pnpm turbo run test --force --concurrency=2 --continue` and
  `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.
- This worktree has no `node_modules` until `pnpm install` runs in it (Task 0).

---

### Task 0: Prepare the worktree

**Files:** none

- [ ] **Step 1: Install dependencies in the worktree**

```bash
cd /d/Projects/Repositories/openldr_ce/.claude/worktrees/garage-storage && git branch --show-current && pnpm install > "$TEMP/wt-install.txt" 2>&1; echo "exit=$?"
```

Expected: `feat/garage-storage`, then `exit=0`.

- [ ] **Step 2: Confirm the adapter tests run here**

```bash
pnpm --filter @openldr/adapter-s3-bucket test > "$TEMP/s3t.txt" 2>&1; echo "exit=$?"; grep -E "Tests|passed|failed" "$TEMP/s3t.txt"
```

Expected: `exit=0`, all tests passed.

---

### Task 1: S3 client with the checksum setting Garage needs

**Files:**
- Create: `packages/adapter-s3-bucket/src/client.ts`
- Modify: `packages/adapter-s3-bucket/src/index.ts:1-37`
- Test: `packages/adapter-s3-bucket/src/client.test.ts`

**Interfaces:**
- Produces: `createS3Client(cfg: S3BucketConfig): S3Client` from `./client`, re-exported from
  `@openldr/adapter-s3-bucket`. `S3BucketConfig` moves to `./client` and stays re-exported from
  the index.

- [ ] **Step 1: Write the failing test**

`packages/adapter-s3-bucket/src/client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/adapter-s3-bucket exec vitest run src/client.test.ts`
Expected: FAIL, cannot resolve `./client`.

- [ ] **Step 3: Write `client.ts`**

```ts
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
```

- [ ] **Step 4: Use it in `index.ts`**

Replace the `S3BucketConfig` interface (lines 15-22) with
`export type { S3BucketConfig } from './client';` plus
`import { createS3Client, type S3BucketConfig } from './client';` and
`export { createS3Client } from './client';`. Remove `S3Client` from the
`@aws-sdk/client-s3` import list but keep it as a type import for `S3BucketDeps`:
`import type { S3Client } from '@aws-sdk/client-s3';`. Replace the inline
`new S3Client({...})` (lines 30-36) with:

```ts
  const client = deps.client ?? createS3Client(cfg);
```

- [ ] **Step 5: Run the package tests and typecheck**

```bash
pnpm --filter @openldr/adapter-s3-bucket test > "$TEMP/s3t.txt" 2>&1; echo "test exit=$?"; pnpm --filter @openldr/adapter-s3-bucket typecheck > "$TEMP/s3tc.txt" 2>&1; echo "tc exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-s3-bucket/src/client.ts packages/adapter-s3-bucket/src/client.test.ts packages/adapter-s3-bucket/src/index.ts
git commit -m "fix(storage): read multipart objects back from Garage without a checksum error"
```

---

### Task 2: S3 copy interface in the adapter

**Files:**
- Create: `packages/adapter-s3-bucket/src/copy.ts`
- Modify: `packages/adapter-s3-bucket/src/index.ts` (add re-export)
- Test: `packages/adapter-s3-bucket/src/copy.test.ts`

**Interfaces:**
- Consumes: `createS3Client`, `S3BucketConfig` from Task 1.
- Produces, exported from `@openldr/adapter-s3-bucket`:

```ts
export interface StoredObject { key: string; size: number }
export interface CopySide {
  /** Every object in the bucket, page by page. */
  list(): AsyncIterable<StoredObject>;
  /** Size in bytes, or null when the key does not exist. */
  sizeOf(key: string): Promise<number | null>;
  read(key: string): Promise<{ body: Readable; contentType?: string }>;
  write(key: string, body: Readable, contentType?: string): Promise<void>;
}
export function createS3CopySide(cfg: S3BucketConfig, deps?: { client?: S3Client }): CopySide;
```

- [ ] **Step 1: Write the failing tests**

`packages/adapter-s3-bucket/src/copy.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createS3CopySide } from './copy';

const cfg = {
  endpoint: 'http://x', region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's',
  bucket: 'openldr', forcePathStyle: true,
};

function clientWith(handlers: Record<string, (input: any) => any>) {
  return {
    send: vi.fn(async (cmd: { constructor: { name: string }; input: unknown }) => {
      const h = handlers[cmd.constructor.name];
      if (!h) throw new Error(`unexpected ${cmd.constructor.name}`);
      return h(cmd.input);
    }),
  };
}

describe('createS3CopySide', () => {
  it('lists every object across pages', async () => {
    const client = clientWith({
      ListObjectsV2Command: (input) =>
        input.ContinuationToken === 't2'
          ? { Contents: [{ Key: 'c', Size: 3 }] }
          : { Contents: [{ Key: 'a', Size: 1 }, { Key: 'b', Size: 2 }], NextContinuationToken: 't2' },
    });
    const side = createS3CopySide(cfg, { client: client as never });
    const seen = [];
    for await (const o of side.list()) seen.push(o);
    expect(seen).toEqual([{ key: 'a', size: 1 }, { key: 'b', size: 2 }, { key: 'c', size: 3 }]);
  });

  it('returns null size for a missing key', async () => {
    const client = clientWith({
      HeadObjectCommand: () => { throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } }; },
    });
    expect(await createS3CopySide(cfg, { client: client as never }).sizeOf('nope')).toBeNull();
  });

  it('returns the size of an existing key', async () => {
    const client = clientWith({ HeadObjectCommand: () => ({ ContentLength: 42 }) });
    expect(await createS3CopySide(cfg, { client: client as never }).sizeOf('k')).toBe(42);
  });

  it('rethrows a non-404 head error instead of reading it as absent', async () => {
    const client = clientWith({
      HeadObjectCommand: () => { throw { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }; },
    });
    await expect(createS3CopySide(cfg, { client: client as never }).sizeOf('k')).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('reads the body and content type', async () => {
    const client = clientWith({
      GetObjectCommand: () => ({ Body: Readable.from([Buffer.from('hi')]), ContentType: 'text/plain' }),
    });
    const r = await createS3CopySide(cfg, { client: client as never }).read('k');
    expect(r.contentType).toBe('text/plain');
    const chunks: Buffer[] = [];
    for await (const c of r.body) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hi');
  });
});
```

`write` uses `Upload` from `@aws-sdk/lib-storage`, which the adapter already uses for
`putStream` and which the fake client cannot drive. It is covered by the live checks in Task 10.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/adapter-s3-bucket exec vitest run src/copy.test.ts`
Expected: FAIL, cannot resolve `./copy`.

- [ ] **Step 3: Write `copy.ts`**

```ts
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
```

Add to `index.ts`: `export { createS3CopySide, type CopySide, type StoredObject } from './copy';`

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @openldr/adapter-s3-bucket test > "$TEMP/s3t.txt" 2>&1; echo "test exit=$?"; pnpm --filter @openldr/adapter-s3-bucket typecheck > "$TEMP/s3tc.txt" 2>&1; echo "tc exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-s3-bucket/src/copy.ts packages/adapter-s3-bucket/src/copy.test.ts packages/adapter-s3-bucket/src/index.ts
git commit -m "feat(storage): list, size, read and write over one bucket for copying"
```

---

### Task 3: `copyStorage` in bootstrap

**Files:**
- Create: `packages/bootstrap/src/storage-copy.ts`
- Modify: `packages/bootstrap/src/index.ts` (export near line 1930)
- Test: `packages/bootstrap/src/storage-copy.test.ts`

**Interfaces:**
- Consumes: `CopySide`, `StoredObject` from `@openldr/adapter-s3-bucket` (Task 2).
- Produces:

```ts
export interface StorageCopyReport {
  sourceObjects: number; sourceBytes: number;
  copied: number; skipped: number;
  targetObjects: number; targetBytes: number;
  /** True when target object count and bytes equal the source's. */
  matches: boolean;
}
export function copyStorage(
  source: CopySide, target: CopySide,
  onProgress?: (done: number, key: string) => void,
): Promise<StorageCopyReport>;
```

- [ ] **Step 1: Write the failing tests**

`packages/bootstrap/src/storage-copy.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { CopySide } from '@openldr/adapter-s3-bucket';
import { copyStorage } from './storage-copy';

function memorySide(initial: Record<string, string> = {}) {
  const objects = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const side: CopySide & { objects: Map<string, Buffer> } = {
    objects,
    async *list() { for (const [key, b] of objects) yield { key, size: b.length }; },
    async sizeOf(key) { return objects.has(key) ? objects.get(key)!.length : null; },
    async read(key) { return { body: Readable.from([objects.get(key)!]), contentType: 'application/octet-stream' }; },
    async write(key, body) {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(c as Buffer);
      objects.set(key, Buffer.concat(chunks));
    },
  };
  return side;
}

describe('copyStorage', () => {
  it('copies every object and reports matching totals', async () => {
    const src = memorySide({ a: 'one', 'b/c': 'three' });
    const dst = memorySide();
    const r = await copyStorage(src, dst);
    expect(r).toEqual({ sourceObjects: 2, sourceBytes: 8, copied: 2, skipped: 0, targetObjects: 2, targetBytes: 8, matches: true });
    expect(dst.objects.get('b/c')!.toString()).toBe('three');
  });

  it('skips an object already on the target with the same size, so a re-run resumes', async () => {
    const src = memorySide({ a: 'one', b: 'two' });
    const dst = memorySide({ a: 'xyz' });
    const write = vi.spyOn(dst, 'write');
    const r = await copyStorage(src, dst);
    expect(r.copied).toBe(1);
    expect(r.skipped).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('copies again when the target has the key at a different size', async () => {
    const src = memorySide({ a: 'one' });
    const dst = memorySide({ a: 'longer' });
    const r = await copyStorage(src, dst);
    expect(r.copied).toBe(1);
    expect(dst.objects.get('a')!.toString()).toBe('one');
  });

  it('reports a mismatch when the target holds extra objects', async () => {
    const src = memorySide({ a: 'one' });
    const dst = memorySide({ stray: 'x' });
    const r = await copyStorage(src, dst);
    expect(r.matches).toBe(false);
    expect(r.targetObjects).toBe(2);
  });

  it('never writes to the source', async () => {
    const src = memorySide({ a: 'one' });
    const write = vi.spyOn(src, 'write');
    await copyStorage(src, memorySide());
    expect(write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/storage-copy.test.ts`
Expected: FAIL, cannot resolve `./storage-copy`.

- [ ] **Step 3: Write `storage-copy.ts`**

```ts
import type { CopySide } from '@openldr/adapter-s3-bucket';

export interface StorageCopyReport {
  sourceObjects: number;
  sourceBytes: number;
  copied: number;
  skipped: number;
  targetObjects: number;
  targetBytes: number;
  matches: boolean;
}

async function totals(side: CopySide): Promise<{ objects: number; bytes: number }> {
  let objects = 0;
  let bytes = 0;
  for await (const o of side.list()) {
    objects += 1;
    bytes += o.size;
  }
  return { objects, bytes };
}

/** Copy every object from `source` to `target`. Shared by the `openldr storage copy` command.
 *
 *  An object already on the target at the same size is skipped, so a run that died part-way
 *  resumes instead of starting over. The source is only read. The final totals are counted
 *  again from the target rather than added up during the copy, so `matches` describes what is
 *  actually there. */
export async function copyStorage(
  source: CopySide,
  target: CopySide,
  onProgress?: (done: number, key: string) => void,
): Promise<StorageCopyReport> {
  let sourceObjects = 0;
  let sourceBytes = 0;
  let copied = 0;
  let skipped = 0;
  for await (const o of source.list()) {
    sourceObjects += 1;
    sourceBytes += o.size;
    if ((await target.sizeOf(o.key)) === o.size) {
      skipped += 1;
    } else {
      const { body, contentType } = await source.read(o.key);
      await target.write(o.key, body, contentType);
      copied += 1;
    }
    onProgress?.(sourceObjects, o.key);
  }
  const t = await totals(target);
  return {
    sourceObjects,
    sourceBytes,
    copied,
    skipped,
    targetObjects: t.objects,
    targetBytes: t.bytes,
    matches: t.objects === sourceObjects && t.bytes === sourceBytes,
  };
}
```

Check `packages/bootstrap/package.json` lists `@openldr/adapter-s3-bucket` as a dependency
(`s3-config.ts` already imports it, so it should). Add near line 1930 of `index.ts`:
`export { copyStorage, type StorageCopyReport } from './storage-copy';`

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/storage-copy.test.ts > "$TEMP/bc.txt" 2>&1; echo "test exit=$?"; pnpm --filter @openldr/bootstrap typecheck > "$TEMP/btc.txt" 2>&1; echo "tc exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/storage-copy.ts packages/bootstrap/src/storage-copy.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(storage): copy every object between two buckets and compare totals"
```

---

### Task 4: `openldr storage copy` command

**Files:**
- Create: `packages/cli/src/storage.ts`
- Modify: `packages/cli/src/program.ts` (import near line 19, register after the `target-store`
  block ending near line 693)
- Test: `packages/cli/src/storage.test.ts`

**Interfaces:**
- Consumes: `copyStorage`, `StorageCopyReport`, `toS3BucketConfig`, `createAppContext`,
  `recordAuditEvent` from `@openldr/bootstrap`; `createS3CopySide` from
  `@openldr/adapter-s3-bucket`; `cliActor` from `./cli-actor`.
- Produces:

```ts
export interface StorageCopyOpts {
  fromEndpoint?: string; fromKey?: string; fromSecret?: string;
  fromBucket?: string; fromRegion: string; json: boolean;
}
export function runStorageCopy(opts: StorageCopyOpts, deps?: {
  copy?: typeof copyStorage;
  targetConfig?: () => S3BucketConfig;
  audit?: (report: StorageCopyReport) => Promise<void>;
}): Promise<number>;
```

Check first that `toS3BucketConfig` is exported from `@openldr/bootstrap`:
`grep -n "s3-config" packages/bootstrap/src/index.ts`. If it is not, add
`export { toS3BucketConfig } from './s3-config';` in this task.

- [ ] **Step 1: Write the failing tests**

`packages/cli/src/storage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runStorageCopy } from './storage';

const target = () => ({
  endpoint: 'http://storage:3900', region: 'us-east-1', accessKeyId: 'GKt', secretAccessKey: 's',
  bucket: 'openldr', forcePathStyle: true,
});
const full = {
  fromEndpoint: 'http://minio:9000', fromKey: 'k', fromSecret: 's', fromBucket: 'openldr',
  fromRegion: 'us-east-1', json: true,
};
const report = (matches: boolean) => ({
  sourceObjects: 2, sourceBytes: 8, copied: 2, skipped: 0,
  targetObjects: matches ? 2 : 1, targetBytes: matches ? 8 : 3, matches,
});

describe('runStorageCopy', () => {
  it('refuses when a source flag is missing', async () => {
    const copy = vi.fn();
    const code = await runStorageCopy({ ...full, fromSecret: undefined }, { copy, targetConfig: target, audit: vi.fn() });
    expect(code).toBe(1);
    expect(copy).not.toHaveBeenCalled();
  });

  it('refuses when source and target are the same bucket on the same endpoint', async () => {
    const copy = vi.fn();
    const code = await runStorageCopy({ ...full, fromEndpoint: 'http://storage:3900' }, { copy, targetConfig: target, audit: vi.fn() });
    expect(code).toBe(1);
    expect(copy).not.toHaveBeenCalled();
  });

  it('exits 0 and audits when totals match', async () => {
    const audit = vi.fn(async () => {});
    const code = await runStorageCopy(full, { copy: vi.fn(async () => report(true)), targetConfig: target, audit });
    expect(code).toBe(0);
    expect(audit).toHaveBeenCalledWith(report(true));
  });

  it('exits non-zero when totals differ, and still audits', async () => {
    const audit = vi.fn(async () => {});
    const code = await runStorageCopy(full, { copy: vi.fn(async () => report(false)), targetConfig: target, audit });
    expect(code).toBe(1);
    expect(audit).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @openldr/cli exec vitest run src/storage.test.ts`
Expected: FAIL, cannot resolve `./storage`.

- [ ] **Step 3: Write `storage.ts`**

```ts
import { loadConfig } from '@openldr/config';
import {
  copyStorage, toS3BucketConfig, createAppContext, recordAuditEvent,
  type StorageCopyReport,
} from '@openldr/bootstrap';
import { createS3CopySide, type S3BucketConfig } from '@openldr/adapter-s3-bucket';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

export interface StorageCopyOpts {
  fromEndpoint?: string;
  fromKey?: string;
  fromSecret?: string;
  fromBucket?: string;
  fromRegion: string;
  json: boolean;
}

async function auditCopy(report: StorageCopyReport): Promise<void> {
  try {
    const ctx = await createAppContext(loadConfig());
    try {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'storage.copy', entityType: 'storage', entityId: 'bucket', metadata: { ...report },
      });
    } finally {
      await ctx.close();
    }
  } catch {
    // audit is best-effort, as db.reset treats it
  }
}

/** Copy every object from another S3 bucket (MinIO on installs that predate Garage) into this
 *  install's storage. Read-only on the source. Exit 1 unless the target totals match. */
export async function runStorageCopy(
  opts: StorageCopyOpts,
  deps: {
    copy?: typeof copyStorage;
    targetConfig?: () => S3BucketConfig;
    audit?: (report: StorageCopyReport) => Promise<void>;
  } = {},
): Promise<number> {
  const missing = (['fromEndpoint', 'fromKey', 'fromSecret', 'fromBucket'] as const)
    .filter((k) => !opts[k]);
  if (missing.length > 0) {
    const flags = missing.map((k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    process.stderr.write(`storage copy: missing ${flags.join(', ')}\n`);
    return 1;
  }
  try {
    const targetCfg = (deps.targetConfig ?? (() => toS3BucketConfig(loadConfig())))();
    if (targetCfg.endpoint === opts.fromEndpoint && targetCfg.bucket === opts.fromBucket) {
      process.stderr.write('storage copy: source and target are the same bucket\n');
      return 1;
    }
    const source = createS3CopySide({
      endpoint: opts.fromEndpoint!, region: opts.fromRegion, accessKeyId: opts.fromKey!,
      secretAccessKey: opts.fromSecret!, bucket: opts.fromBucket!, forcePathStyle: true,
    });
    const target = createS3CopySide(targetCfg);
    const report = await (deps.copy ?? copyStorage)(source, target, (done) => {
      if (!opts.json && done % 500 === 0) process.stderr.write(`  ${done} objects...\n`);
    });
    await (deps.audit ?? auditCopy)(report);
    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stdout.write(
        `source: ${report.sourceObjects} objects, ${report.sourceBytes} bytes\n` +
          `target: ${report.targetObjects} objects, ${report.targetBytes} bytes\n` +
          `copied ${report.copied}, skipped ${report.skipped} already present\n` +
          (report.matches ? 'totals match\n' : 'TOTALS DIFFER: do not switch to the new storage yet\n'),
      );
    }
    return report.matches ? 0 : 1;
  } catch (err) {
    process.stderr.write(`storage copy failed: ${redactError(err)}\n`);
    return 1;
  }
}
```

Check `packages/cli/package.json` lists `@openldr/adapter-s3-bucket`. If not, add
`"@openldr/adapter-s3-bucket": "workspace:*"` to `dependencies` and run `pnpm install` once.

- [ ] **Step 4: Register the command in `program.ts`**

Import: `import { runStorageCopy } from './storage';`. After the `target-store` block:

```ts
  const storage = program.command('storage').description('Object storage tools');
  storage
    .command('copy')
    .description('Copy every object from another S3 bucket into this install\'s storage (read-only on the source)')
    .option('--from-endpoint <url>', 'source S3 endpoint, e.g. http://minio:9000')
    .option('--from-key <key>', 'source access key ID')
    .option('--from-secret <secret>', 'source secret access key')
    .option('--from-bucket <bucket>', 'source bucket name')
    .option('--from-region <region>', 'source region', 'us-east-1')
    .option('--json', 'emit machine-readable JSON', false)
    .action(async (opts: { fromEndpoint?: string; fromKey?: string; fromSecret?: string; fromBucket?: string; fromRegion: string; json: boolean }) => {
      process.exitCode = await runStorageCopy(opts);
    });
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @openldr/cli exec vitest run src/storage.test.ts > "$TEMP/cs.txt" 2>&1; echo "test exit=$?"; pnpm --filter @openldr/cli typecheck > "$TEMP/ctc.txt" 2>&1; echo "tc exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/storage.ts packages/cli/src/storage.test.ts packages/cli/src/program.ts packages/cli/package.json packages/bootstrap/src/index.ts pnpm-lock.yaml
git commit -m "feat(cli): openldr storage copy moves objects from MinIO into Garage"
```

---

### Task 5: The image list and its checks

**Files:**
- Create: `deploy/third-party-images.json`
- Create: `packages/release/src/third-party.ts`
- Modify: `packages/release/src/index.ts` (add `export * from './third-party';`)
- Test: `packages/release/src/third-party.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ThirdPartyImage { name: string; upstream: string; copy: string; digest: string }
export interface ThirdPartyList { images: ThirdPartyImage[]; exceptions: { image: string; reason: string }[] }
export const OWN_IMAGE_PREFIX = 'ghcr.io/open-laboratory-data-repository/openldr-';
export function parseThirdPartyList(json: string): ThirdPartyList;
export function imageRefs(text: string, kind: 'compose' | 'dockerfile'): string[];
export function badImageRefs(refs: string[], list: ThirdPartyList): string[];
export function replaceDigest(text: string, copy: string, oldDigest: string, newDigest: string): string;
export function pinnedRef(img: ThirdPartyImage): string; // `${copy}@${digest}`
```

- [ ] **Step 1: Create the list with empty digests**

`deploy/third-party-images.json`:

```json
{
  "images": [
    { "name": "garage", "upstream": "dxflrs/garage:v2.4.1", "copy": "ghcr.io/open-laboratory-data-repository/garage:v2.4.1", "digest": "" },
    { "name": "postgres", "upstream": "postgres:16-alpine", "copy": "ghcr.io/open-laboratory-data-repository/postgres:16-alpine", "digest": "" },
    { "name": "certbot", "upstream": "certbot/certbot:v5.8.0", "copy": "ghcr.io/open-laboratory-data-repository/certbot:v5.8.0", "digest": "" },
    { "name": "mysql", "upstream": "mysql:8.4", "copy": "ghcr.io/open-laboratory-data-repository/mysql:8.4", "digest": "" },
    { "name": "nginx", "upstream": "nginx:1.27-alpine", "copy": "ghcr.io/open-laboratory-data-repository/nginx:1.27-alpine", "digest": "" },
    { "name": "node", "upstream": "node:22-bookworm-slim", "copy": "ghcr.io/open-laboratory-data-repository/node:22-bookworm-slim", "digest": "" },
    { "name": "keycloak", "upstream": "quay.io/keycloak/keycloak:26.0", "copy": "ghcr.io/open-laboratory-data-repository/keycloak:26.0", "digest": "" }
  ],
  "exceptions": [
    { "image": "mcr.microsoft.com/mssql/server:2022-latest", "reason": "Microsoft's licence may not allow us to host a copy. Operator decision, 2026-10-09." }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`packages/release/src/third-party.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseThirdPartyList, imageRefs, badImageRefs, replaceDigest, pinnedRef } from './third-party';

const D1 = `sha256:${'a'.repeat(64)}`;
const D2 = `sha256:${'b'.repeat(64)}`;
const list = parseThirdPartyList(JSON.stringify({
  images: [{ name: 'postgres', upstream: 'postgres:16-alpine', copy: 'ghcr.io/open-laboratory-data-repository/postgres:16-alpine', digest: D1 }],
  exceptions: [{ image: 'mcr.microsoft.com/mssql/server:2022-latest', reason: 'licence' }],
}));

describe('imageRefs', () => {
  it('reads compose image lines', () => {
    const text = 'services:\n  db:\n    image: postgres:16-alpine\n  x:\n    image: "nginx:1.27"\n';
    expect(imageRefs(text, 'compose')).toEqual(['postgres:16-alpine', 'nginx:1.27']);
  });
  it('reads Dockerfile FROM lines and drops the stage name', () => {
    const text = 'FROM node:22 AS build\nRUN x\nFROM --platform=linux/amd64 nginx:1.27-alpine\n';
    expect(imageRefs(text, 'dockerfile')).toEqual(['node:22', 'nginx:1.27-alpine']);
  });
  it('ignores a FROM that names an earlier stage', () => {
    expect(imageRefs('FROM node:22 AS build\nFROM build AS final\n', 'dockerfile')).toEqual(['node:22']);
  });
});

describe('badImageRefs', () => {
  it('accepts a pinned copy from the list', () => {
    expect(badImageRefs([pinnedRef(list.images[0]!)], list)).toEqual([]);
  });
  it('accepts our own images', () => {
    expect(badImageRefs(['ghcr.io/open-laboratory-data-repository/openldr-api:${OPENLDR_VERSION:-latest}'], list)).toEqual([]);
  });
  it('accepts a listed exception', () => {
    expect(badImageRefs(['mcr.microsoft.com/mssql/server:2022-latest'], list)).toEqual([]);
  });
  it('rejects a vendor image', () => {
    expect(badImageRefs(['postgres:16-alpine'], list)).toEqual(['postgres:16-alpine']);
  });
  it('rejects a copy without the digest', () => {
    expect(badImageRefs(['ghcr.io/open-laboratory-data-repository/postgres:16-alpine'], list)).toHaveLength(1);
  });
  it('rejects a copy pinned to a stale digest', () => {
    expect(badImageRefs([`ghcr.io/open-laboratory-data-repository/postgres:16-alpine@${D2}`], list)).toHaveLength(1);
  });
});

describe('parseThirdPartyList', () => {
  it('refuses an entry whose copy is not under our GHCR org', () => {
    expect(() => parseThirdPartyList(JSON.stringify({
      images: [{ name: 'x', upstream: 'x:1', copy: 'docker.io/x:1', digest: '' }], exceptions: [],
    }))).toThrow(/ghcr\.io\/open-laboratory-data-repository/);
  });
});

describe('replaceDigest', () => {
  it('swaps the digest on every pinned reference to that copy', () => {
    const copy = 'ghcr.io/open-laboratory-data-repository/postgres:16-alpine';
    const text = `image: ${copy}@${D1}\nFROM ${copy}@${D1} AS x\n`;
    expect(replaceDigest(text, copy, D1, D2)).toBe(`image: ${copy}@${D2}\nFROM ${copy}@${D2} AS x\n`);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @openldr/release exec vitest run src/third-party.test.ts`
Expected: FAIL, cannot resolve `./third-party`.

- [ ] **Step 4: Write `third-party.ts`**

```ts
export interface ThirdPartyImage { name: string; upstream: string; copy: string; digest: string }
export interface ThirdPartyList {
  images: ThirdPartyImage[];
  exceptions: { image: string; reason: string }[];
}

const ORG = 'ghcr.io/open-laboratory-data-repository/';
export const OWN_IMAGE_PREFIX = `${ORG}openldr-`;

export function parseThirdPartyList(json: string): ThirdPartyList {
  const raw = JSON.parse(json) as ThirdPartyList;
  for (const img of raw.images) {
    if (!img.copy.startsWith(ORG)) {
      throw new Error(`${img.name}: copy must live under ${ORG}, got ${img.copy}`);
    }
  }
  return { images: raw.images, exceptions: raw.exceptions ?? [] };
}

export function pinnedRef(img: ThirdPartyImage): string {
  return `${img.copy}@${img.digest}`;
}

/** Image references in a compose file (`image:` lines) or a Dockerfile (`FROM` lines). A FROM
 *  that names an earlier `AS` stage is not an image and is skipped. */
export function imageRefs(text: string, kind: 'compose' | 'dockerfile'): string[] {
  const refs: string[] = [];
  if (kind === 'compose') {
    for (const m of text.matchAll(/^\s*image:\s*["']?([^"'\s#]+)["']?/gm)) refs.push(m[1]!);
    return refs;
  }
  const stages = new Set<string>();
  for (const m of text.matchAll(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/gim)) {
    const image = m[1]!;
    if (!stages.has(image.toLowerCase())) refs.push(image);
    if (m[2]) stages.add(m[2].toLowerCase());
  }
  return refs;
}

/** References that break the policy: not ours, not a pinned copy from the list, and not a
 *  listed exception. */
export function badImageRefs(refs: string[], list: ThirdPartyList): string[] {
  const allowed = new Set([
    ...list.images.filter((i) => i.digest !== '').map(pinnedRef),
    ...list.exceptions.map((e) => e.image),
  ]);
  return refs.filter((r) => !r.startsWith(OWN_IMAGE_PREFIX) && !allowed.has(r));
}

export function replaceDigest(text: string, copy: string, oldDigest: string, newDigest: string): string {
  return text.split(`${copy}@${oldDigest}`).join(`${copy}@${newDigest}`);
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @openldr/release exec vitest run src/third-party.test.ts > "$TEMP/tp.txt" 2>&1; echo "test exit=$?"; pnpm --filter @openldr/release typecheck > "$TEMP/rtc.txt" 2>&1; echo "tc exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add deploy/third-party-images.json packages/release/src/third-party.ts packages/release/src/third-party.test.ts packages/release/src/index.ts
git commit -m "feat(release): list third-party images and check references against it"
```

---

### Task 6: Copy the images to GHCR and point everything at the copies

**Files:**
- Create: `scripts/mirror-images.ts`
- Modify: `package.json` (scripts: `"images:mirror": "tsx scripts/mirror-images.ts"`)
- Modify: `deploy/third-party-images.json` (digests, written by the script)
- Modify: `deploy/install/docker-compose.yml:63,136`, `deploy/install/docker-compose.mysql.yml:6,22`,
  `docker-compose.prod.yml:36,60,68`, `apps/server/Dockerfile:4,29`, `apps/studio/Dockerfile:4,12`,
  `apps/web/Dockerfile:3,11`, `deploy/nginx/Dockerfile:5`, `deploy/keycloak/Dockerfile:4`
- Create: `packages/release/src/third-party-repo.test.ts`

**Interfaces:**
- Consumes: everything from Task 5.

- [ ] **Step 1: Write the script**

`scripts/mirror-images.ts`:

```ts
// Copy one third-party image into our GHCR and record its digest.
//   pnpm images:mirror garage        copy one
//   pnpm images:mirror --all         copy every entry in deploy/third-party-images.json
// The copy happens registry-side (docker buildx imagetools create) and keeps every platform.
// Run it on purpose to take an upstream update. Then rerun the release tests: the repo test
// fails until every compose file and Dockerfile carries the new digest, which this script
// rewrites for you.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseThirdPartyList, replaceDigest } from '../packages/release/src/third-party';
import { POLICY_FILES } from '../packages/release/src/third-party-files';

const repo = join(fileURLToPath(import.meta.url), '..', '..');
const listPath = join(repo, 'deploy/third-party-images.json');
const OWNER = 'Open-Laboratory-Data-Repository';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: pnpm images:mirror <name>|--all');
  process.exit(1);
}
const listText = readFileSync(listPath, 'utf8');
const list = parseThirdPartyList(listText);
const targets = arg === '--all' ? list.images : list.images.filter((i) => i.name === arg);
if (targets.length === 0) {
  console.error(`no entry named ${arg} in deploy/third-party-images.json`);
  process.exit(1);
}

for (const img of targets) {
  console.log(`+ docker buildx imagetools create --tag ${img.copy} ${img.upstream}`);
  execFileSync('docker', ['buildx', 'imagetools', 'create', '--tag', img.copy, img.upstream], { stdio: 'inherit' });
  const digest = execFileSync(
    'docker', ['buildx', 'imagetools', 'inspect', img.copy, '--format', '{{json .Manifest.Digest}}'],
    { encoding: 'utf8' },
  ).trim().replace(/"/g, '');
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`unexpected digest for ${img.copy}: ${digest}`);
  if (img.digest && img.digest !== digest) {
    for (const rel of POLICY_FILES) {
      const p = join(repo, rel);
      const before = readFileSync(p, 'utf8');
      const after = replaceDigest(before, img.copy, img.digest, digest);
      if (after !== before) { writeFileSync(p, after); console.log(`  updated ${rel}`); }
    }
  }
  img.digest = digest;
  console.log(`  ${img.name} -> ${digest}`);
  console.log(`  make it public if new: https://github.com/orgs/${OWNER}/packages/container/${img.name}/settings`);
}
writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');
```

Create `packages/release/src/third-party-files.ts` so the script and the repo test share one file
list:

```ts
/** Files the third-party image policy covers. The dev compose (docker-compose.yml) is left out
 *  on purpose: developers have its images cached and its mssql/mysql tags come from variables. */
export const POLICY_FILES = [
  'deploy/install/docker-compose.yml',
  'deploy/install/docker-compose.mssql.yml',
  'deploy/install/docker-compose.mysql.yml',
  'docker-compose.prod.yml',
  'apps/server/Dockerfile',
  'apps/studio/Dockerfile',
  'apps/web/Dockerfile',
  'deploy/nginx/Dockerfile',
  'deploy/keycloak/Dockerfile',
] as const;
```

Export it from `packages/release/src/index.ts`. Add `"images:mirror": "tsx scripts/mirror-images.ts"`
to the root `package.json` scripts.

- [ ] **Step 2: Copy all seven images**

Docker must be logged in to ghcr.io with `write:packages` (it is, as of 2026-10-09).

```bash
pnpm images:mirror --all > "$TEMP/mirror.txt" 2>&1; echo "exit=$?"; grep -E "^\s+\S+ -> sha256|ERROR|error" "$TEMP/mirror.txt"
```

Expected: `exit=0` and seven `name -> sha256:...` lines. `cat deploy/third-party-images.json`
shows seven non-empty digests.

- [ ] **Step 3: STOP. Operator makes the seven packages public**

New GHCR packages start private, and there is no API to change that. Ask the operator to open
each settings URL the script printed and set visibility to Public. Then verify anonymously:

```bash
for img in garage postgres certbot mysql nginx node keycloak; do tok=$(curl -s "https://ghcr.io/token?scope=repository:open-laboratory-data-repository/$img:pull" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//'); echo "$img $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tok" -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' https://ghcr.io/v2/open-laboratory-data-repository/$img/manifests/$(node -e "const l=require('./deploy/third-party-images.json');console.log(l.images.find(i=>i.name==='$img').digest)"))"; done
```

Expected: all seven print `200`. Do not continue on any 401 or 403.

- [ ] **Step 4: Write the failing repo test**

`packages/release/src/third-party-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseThirdPartyList, imageRefs, badImageRefs } from './third-party';
import { POLICY_FILES } from './third-party-files';

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const list = parseThirdPartyList(readFileSync(join(REPO, 'deploy/third-party-images.json'), 'utf8'));

describe('third-party image policy', () => {
  it('every listed image has a digest', () => {
    expect(list.images.filter((i) => !/^sha256:[0-9a-f]{64}$/.test(i.digest)).map((i) => i.name)).toEqual([]);
  });

  for (const rel of POLICY_FILES) {
    it(`${rel} pulls only our images, pinned copies, or listed exceptions`, () => {
      const kind = rel.endsWith('Dockerfile') ? 'dockerfile' : 'compose';
      const refs = imageRefs(readFileSync(join(REPO, rel), 'utf8'), kind);
      expect(refs.length).toBeGreaterThan(0);
      expect(badImageRefs(refs, list)).toEqual([]);
    });
  }
});
```

Run: `pnpm --filter @openldr/release exec vitest run src/third-party-repo.test.ts`
Expected: FAIL, listing vendor references such as `postgres:16-alpine` and `node:22-bookworm-slim`.
`deploy/install/docker-compose.yml` and `docker-compose.prod.yml` also list the MinIO images;
Task 7 removes those. They stay failing until then.

- [ ] **Step 5: Point compose files and Dockerfiles at the copies**

For each reference below, replace the vendor image with `<copy>@<digest>` taken from
`deploy/third-party-images.json`. Print the exact strings with:
`node -e "for (const i of require('./deploy/third-party-images.json').images) console.log(i.name, i.copy + '@' + i.digest)"`

| File | Line | From | To (entry name) |
|---|---|---|---|
| `deploy/install/docker-compose.yml` | 63 | `postgres:16-alpine` | postgres |
| `deploy/install/docker-compose.yml` | 136 | `certbot/certbot:latest` | certbot |
| `deploy/install/docker-compose.mysql.yml` | 6, 22 | `mysql:8.4` | mysql |
| `docker-compose.prod.yml` | 36 | `nginx:1.27-alpine` | nginx |
| `docker-compose.prod.yml` | 60 | `certbot/certbot:latest` | certbot |
| `docker-compose.prod.yml` | 68 | `postgres:16-alpine` | postgres |
| `apps/server/Dockerfile` | 4, 29 | `node:22-bookworm-slim` | node |
| `apps/studio/Dockerfile` | 4 | `node:22-bookworm-slim` | node |
| `apps/studio/Dockerfile` | 12 | `nginx:1.27-alpine` | nginx |
| `apps/web/Dockerfile` | 3 | `node:22-bookworm-slim` | node |
| `apps/web/Dockerfile` | 11 | `nginx:1.27-alpine` | nginx |
| `deploy/nginx/Dockerfile` | 5 | `nginx:1.27-alpine` | nginx |
| `deploy/keycloak/Dockerfile` | 4 | `quay.io/keycloak/keycloak:26.0` | keycloak |

Keep each Dockerfile's `AS <stage>` suffix. Above the first changed line in each file, add one
comment: `# Third-party images come from our GHCR copies (deploy/third-party-images.json).`

- [ ] **Step 6: Check the Dockerfiles still build**

```bash
for f in apps/server/Dockerfile apps/studio/Dockerfile apps/web/Dockerfile; do docker buildx build --platform linux/amd64 -f $f --target build -o type=cacheonly . > "$TEMP/b.txt" 2>&1; echo "$f exit=$?"; done; docker buildx build -f deploy/nginx/Dockerfile -o type=cacheonly deploy/nginx > "$TEMP/b.txt" 2>&1; echo "nginx exit=$?"; docker buildx build -f deploy/keycloak/Dockerfile -o type=cacheonly deploy/keycloak > "$TEMP/b.txt" 2>&1; echo "keycloak exit=$?"
```

Expected: five `exit=0`. If `--target build` does not exist in a Dockerfile, drop it for that file.

- [ ] **Step 7: Run the repo test**

Run: `pnpm --filter @openldr/release exec vitest run src/third-party-repo.test.ts`
Expected: every test passes except `deploy/install/docker-compose.yml` and
`docker-compose.prod.yml`, which still list `minio/minio:latest` and `minio/mc:latest`.

- [ ] **Step 8: Commit**

```bash
git add scripts/mirror-images.ts package.json deploy/third-party-images.json packages/release/src/third-party-files.ts packages/release/src/third-party-repo.test.ts packages/release/src/index.ts deploy/install/docker-compose.yml deploy/install/docker-compose.mysql.yml docker-compose.prod.yml apps/server/Dockerfile apps/studio/Dockerfile apps/web/Dockerfile deploy/nginx/Dockerfile deploy/keycloak/Dockerfile
git commit -m "feat(deploy): pull third-party images from our GHCR copies, pinned by digest"
```

---

### Task 7: The `storage` service

**Files:**
- Create: `deploy/install/garage.toml`
- Modify: `deploy/install/docker-compose.yml:29-31,80-96,143-145`
- Modify: `docker-compose.prod.yml:15-17,87-104,141-143`
- Modify: `docker-compose.yml:21-37` (and add a `volumes:` entry if the file has none)
- Modify: `install/install.sh:329-333,405,433,498-503`, `install/install.ps1:265-269,309-316,347,417-422`
- Modify: `scripts/init/secrets.mjs`, `scripts/init/secrets.test.mjs`
- Modify: `.env.example:22-27`, `.env.prod.example:65-71`
- Modify: `install/development.sh:85-86` (comment and echo text only)
- Modify: `packages/release/src/shell.test.ts` (`installSh` returns the install dir; new test)

**Interfaces:**
- Consumes: the `garage` entry's pinned ref from Task 6.

- [ ] **Step 1: Write `deploy/install/garage.toml`**

```toml
# Garage config for the OpenLDR `storage` service. No secrets here: GARAGE_RPC_SECRET,
# GARAGE_ADMIN_TOKEN and the default key come from the environment.
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
# Same region every install already has in S3_REGION.
s3_region = "us-east-1"
api_bind_addr = "[::]:3900"

[admin]
api_bind_addr = "[::]:3903"
```

- [ ] **Step 2: Replace `minio` and `minio-init` in `deploy/install/docker-compose.yml`**

Delete both services (lines 80-96). Add, using the pinned garage ref from the list:

```yaml
  # S3-compatible object storage (Garage). MinIO's images left Docker Hub on 2026-09-11; an
  # install from before 0.1.10 moves its objects with `openldr storage copy` (see the upgrading
  # guide). Garage creates its key and bucket on first start from the values below.
  storage:
    image: ghcr.io/open-laboratory-data-repository/garage:v2.4.1@<digest from the list>
    command: ["/garage", "server", "--single-node", "--default-bucket"]
    environment:
      GARAGE_RPC_SECRET: ${GARAGE_RPC_SECRET:?GARAGE_RPC_SECRET is missing. An install from before 0.1.10 must follow the MinIO to Garage steps in the upgrading guide}
      GARAGE_ADMIN_TOKEN: ${GARAGE_ADMIN_TOKEN:?GARAGE_ADMIN_TOKEN is missing. See the upgrading guide}
      GARAGE_DEFAULT_ACCESS_KEY: ${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID must be set}
      GARAGE_DEFAULT_SECRET_KEY: ${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY must be set}
      GARAGE_DEFAULT_BUCKET: ${S3_BUCKET:-openldr}
    volumes:
      - ./config/garage.toml:/etc/garage.toml:ro
      - storagedata:/var/lib/garage
    expose: ["3900"]
    healthcheck:
      test: ["CMD", "/garage", "status"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped
```

Replace `<digest from the list>` with the real digest when you edit. The repo test from Task 6
fails if it is wrong. In the `api` service `depends_on` (line 31), replace
`minio: { condition: service_started }` with `storage: { condition: service_healthy }`. In
`volumes:` (line 145), replace `miniodata:` with `storagedata:`.

- [ ] **Step 3: Same change in `docker-compose.prod.yml`**

Same `storage` service, except the config mount is
`./deploy/install/garage.toml:/etc/garage.toml:ro` and the `:?` messages say `must be set in
.env.prod`. Change the api `depends_on` (line 17) and replace `miniodata:` with `storagedata:`
(line 143).

- [ ] **Step 4: Same change in the dev `docker-compose.yml`**

```yaml
  storage:
    image: ghcr.io/open-laboratory-data-repository/garage:v2.4.1@<digest from the list>
    command: ["/garage", "server", "--single-node", "--default-bucket"]
    environment:
      # Dev-only fixed values, in the formats Garage requires. Never used by an installer.
      GARAGE_RPC_SECRET: 6465762d6f6e6c792d6761726167652d7270632d7365637265742d3030303031
      GARAGE_ADMIN_TOKEN: 6465762d6f6e6c792d6761726167652d61646d696e2d746f6b656e2d30303031
      GARAGE_DEFAULT_ACCESS_KEY: GK6f70656e6c64722d64657621
      GARAGE_DEFAULT_SECRET_KEY: 6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031
      GARAGE_DEFAULT_BUCKET: openldr
    volumes:
      - ./deploy/install/garage.toml:/etc/garage.toml:ro
      - storagedata:/var/lib/garage
    ports:
      - "9010:3900"
    healthcheck:
      test: ["CMD", "/garage", "status"]
      interval: 5s
      timeout: 5s
      retries: 20
```

Remove `minio` and `minio-init`. Add `storagedata:` to the top-level `volumes:` (create the key
if the file has none). Update the header comment on line 3 from `MinIO 9000/9001` to
`S3 storage 9010`.

- [ ] **Step 5: Update `.env.example` and `.env.prod.example`**

In `.env.example` (lines 24-25):

```
S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621
S3_SECRET_ACCESS_KEY=6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031
```

In `.env.prod.example`, change the comment on line 65 to `# Blob storage (the \`storage\` service, Garage)`
and set:

```
S3_ENDPOINT=http://storage:3900
S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621
S3_SECRET_ACCESS_KEY=6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031
GARAGE_RPC_SECRET=6465762d6f6e6c792d6761726167652d7270632d7365637265742d3030303031
GARAGE_ADMIN_TOKEN=6465762d6f6e6c792d6761726167652d61646d696e2d746f6b656e2d30303031
```

Also change `minio` to `storage` in the comment on line 2.

- [ ] **Step 6: Failing test for `pnpm run init` secrets**

Add to `scripts/init/secrets.test.mjs`, in the existing `describe` for `ensureStackSecrets`:

```js
  it('replaces the dev storage values with keys in the format Garage requires', () => {
    const env = [
      'S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621',
      'S3_SECRET_ACCESS_KEY=6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031',
      'GARAGE_RPC_SECRET=6465762d6f6e6c792d6761726167652d7270632d7365637265742d3030303031',
      'GARAGE_ADMIN_TOKEN=6465762d6f6e6c792d6761726167652d61646d696e2d746f6b656e2d30303031',
    ].join('\n');
    const { envText } = ensureStackSecrets(env);
    expect(envText).toMatch(/^S3_ACCESS_KEY_ID=GK[0-9a-f]{24}$/m);
    expect(envText).not.toMatch(/^S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621$/m);
    expect(envText).toMatch(/^S3_SECRET_ACCESS_KEY=[0-9a-f]{64}$/m);
    expect(envText).toMatch(/^GARAGE_RPC_SECRET=[0-9a-f]{64}$/m);
    expect(envText).toMatch(/^GARAGE_ADMIN_TOKEN=[0-9a-f]{64}$/m);
    expect(envText).not.toMatch(/6465762d6f6e6c79/);
  });
```

Check the existing minioadmin assertions at `secrets.test.mjs:14-27` still pass after Step 7.
They expect `minioadmin` to be replaced, which stays true.

Run: `node --test scripts/init/secrets.test.mjs` if the file uses `node:test`, else
`pnpm exec vitest run scripts/init/secrets.test.mjs`. Check the first import line of the file to
pick. Expected: the new test FAILS (keys are alphanumeric, not hex).

- [ ] **Step 7: Generate Garage-format keys in `secrets.mjs`**

Add generators and per-key overrides:

```js
const hex = (bytes) => randomBytes(bytes).toString('hex');

// Garage refuses any other format: key ID is GK + 24 hex, secrets are 64 hex.
const GENERATORS = {
  S3_ACCESS_KEY_ID: () => `GK${hex(12)}`,
  S3_SECRET_ACCESS_KEY: () => hex(32),
  GARAGE_RPC_SECRET: () => hex(32),
  GARAGE_ADMIN_TOKEN: () => hex(32),
};
```

Extend `WEAK_DEFAULTS`:

```js
  S3_ACCESS_KEY_ID: ['', 'minioadmin', 'GK6f70656e6c64722d64657621'],
  S3_SECRET_ACCESS_KEY: ['', 'minioadmin', '6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031'],
  GARAGE_RPC_SECRET: ['', '6465762d6f6e6c792d6761726167652d7270632d7365637265742d3030303031'],
  GARAGE_ADMIN_TOKEN: ['', '6465762d6f6e6c792d6761726167652d61646d696e2d746f6b656e2d30303031'],
```

In the `ensureStackSecrets` loop, use the per-key generator when one exists:

```js
    if (cur === undefined || weak.includes(cur)) text = setEnv(text, key, (GENERATORS[key] ?? gen)());
```

The injectable `gen` stays for the other keys, so existing deterministic tests keep working.
Re-run the test from Step 6. Expected: PASS, and the whole file passes.

- [ ] **Step 8: Failing installer test**

In `packages/release/src/shell.test.ts`, change `installSh` to also return the install directory:
`function installSh(args: string[]): { code: number; out: string; dir: string }`, and return
`dir` from both the success and the catch branch. Then add:

```ts
describe('install.sh storage keys', () => {
  it('writes Garage-format storage keys and points S3 at the storage service', () => {
    const r = installSh(['--no-start']);
    expect(r.code).toBe(0);
    const env = readFileSync(join(r.dir, '.env'), 'utf8');
    expect(env).toMatch(/^S3_ENDPOINT=http:\/\/storage:3900$/m);
    expect(env).toMatch(/^S3_ACCESS_KEY_ID=GK[0-9a-f]{24}$/m);
    expect(env).toMatch(/^S3_SECRET_ACCESS_KEY=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^GARAGE_RPC_SECRET=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^GARAGE_ADMIN_TOKEN=[0-9a-f]{64}$/m);
  }, 60_000);
});
```

Add `readFileSync` to the file's `node:fs` import if it is missing.
Run: `pnpm --filter @openldr/release exec vitest run src/shell.test.ts -t "storage keys"`
Expected: FAIL, `S3_ENDPOINT=http://minio:9000`.

- [ ] **Step 9: Change `install.sh`**

After `rand()` on line 405, add:

```sh
# Garage refuses any other format: key ID is GK + 24 hex, secrets are 64 hex.
hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
```

Line 433: replace `S3_KEY="$(rand)"; S3_SECRET="$(rand)"` with
`S3_KEY="GK$(hex 12)"; S3_SECRET="$(hex 32)"; GARAGE_RPC="$(hex 32)"; GARAGE_ADMIN="$(hex 32)"`.
In the `.env` heredoc (line 498), replace `S3_ENDPOINT=http://minio:9000` with
`S3_ENDPOINT=http://storage:3900` and add after `S3_FORCE_PATH_STYLE=true`:

```
GARAGE_RPC_SECRET=$GARAGE_RPC
GARAGE_ADMIN_TOKEN=$GARAGE_ADMIN
```

After line 332 (`fetch "scripts/init-keycloak-db.sql" ...`), add:
`fetch "deploy/install/garage.toml" "$DIR/config/garage.toml"`.

Re-run the Step 8 test. Expected: PASS. Then run the whole shell test file:
`pnpm --filter @openldr/release exec vitest run src/shell.test.ts`. Expected: all pass.

- [ ] **Step 10: Change `install.ps1` to match**

After the `Rand` function (ends near line 316), add:

```powershell
# Garage refuses any other format: key ID is GK + 24 hex, secrets are 64 hex.
function Hex([int]$n) {
  $bytes = New-Object 'System.Byte[]' $n
  $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
```

Line 347: replace `$s3k = Rand; $s3s = Rand` with
`$s3k = "GK$(Hex 12)"; $s3s = Hex 32; $garageRpc = Hex 32; $garageAdmin = Hex 32`.
Line 417: `S3_ENDPOINT=http://storage:3900`. After `S3_FORCE_PATH_STYLE=true`, add
`GARAGE_RPC_SECRET=$garageRpc` and `GARAGE_ADMIN_TOKEN=$garageAdmin`. After line 269 add
`Fetch "deploy/install/garage.toml" "$Dir/config/garage.toml"`.

Check it parses: `powershell.exe -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('install/install.ps1',[ref]\$null,[ref]\$e); \$e.Count"`
Expected: `0`.

- [ ] **Step 11: Update `install/development.sh` lines 85-86**

Replace `minio` with `storage` in the comment and the echo text.

- [ ] **Step 12: Live check, dev stack on Garage**

```bash
docker compose up -d storage > "$TEMP/dc.txt" 2>&1; echo "up exit=$?"; for i in $(seq 1 30); do s=$(docker inspect -f '{{.State.Health.Status}}' $(docker compose ps -q storage)); [ "$s" = healthy ] && break; sleep 2; done; echo "health=$s"
```

Expected: `up exit=0`, `health=healthy`. Then point a local `.env` at it (only the two S3 key lines
change for a dev `.env` copied from the old example) and run
`pnpm --filter @openldr/server dev` long enough to call `openldr health`, or run
`pnpm --filter @openldr/cli exec tsx src/index.ts health --json`. Expected: blob `up`.

The main checkout's dev stack also runs a `minio` container on 9010. Stop it first
(`docker compose -p openldr_ce stop minio` from the main checkout) and say so to the operator,
because another session may be using it. Ask before stopping it.

- [ ] **Step 13: Run the release package tests**

Run: `pnpm --filter @openldr/release test > "$TEMP/rel.txt" 2>&1; echo "exit=$?"`
Expected: `exit=0`. The repo policy test now passes for every file.

- [ ] **Step 14: Commit**

```bash
git add deploy/install/garage.toml deploy/install/docker-compose.yml docker-compose.prod.yml docker-compose.yml install/install.sh install/install.ps1 install/development.sh scripts/init/secrets.mjs scripts/init/secrets.test.mjs .env.example .env.prod.example packages/release/src/shell.test.ts
git commit -m "feat(deploy): replace MinIO with a Garage storage service"
```

---

### Task 8: Release refuses a missing or private third-party copy

**Files:**
- Modify: `packages/release/src/preconditions.ts` (new fact and refusal)
- Modify: `packages/release/src/preconditions.test.ts`
- Modify: `packages/release/src/registry.ts` (new `findUnavailablePackages`)
- Modify: `packages/release/src/registry.test.ts`
- Modify: `scripts/release.ts:290-303`

**Interfaces:**
- Produces: `ReleaseFacts.thirdPartyUnavailable: string[]`;
  `findUnavailablePackages(fetchJson, org, images): Promise<string[]>`, which returns
  `"<name> (private)"` or `"<name> (missing or unreadable)"` per bad package and never throws.

- [ ] **Step 1: Failing tests**

In `preconditions.test.ts`, add `thirdPartyUnavailable: []` to the `clean` fixture and:

```ts
  it('refuses when a third-party copy is missing or private', () => {
    const r = evaluatePreconditions({ ...clean, thirdPartyUnavailable: ['garage (private)'] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/garage \(private\)/);
    expect(r[0]).toMatch(/third-party/);
  });
```

In `registry.test.ts`:

```ts
describe('findUnavailablePackages', () => {
  it('names private and unreadable packages and never throws', async () => {
    const fetchJson = async (path: string) => {
      if (path.endsWith('/garage')) return { visibility: 'public' };
      if (path.endsWith('/node')) return { visibility: 'private' };
      throw new Error('HTTP 404');
    };
    expect(await findUnavailablePackages(fetchJson, 'o', ['garage', 'node', 'mysql']))
      .toEqual(['node (private)', 'mysql (missing or unreadable)']);
  });
});
```

Run: `pnpm --filter @openldr/release exec vitest run src/preconditions.test.ts src/registry.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`registry.ts`:

```ts
/** Like findPrivatePackages, but a package that cannot be read is reported, not thrown. A
 *  missing third-party copy must refuse the release with its name, not crash it. */
export async function findUnavailablePackages(
  fetchJson: FetchJson,
  org: string,
  images: readonly string[],
): Promise<string[]> {
  const bad: string[] = [];
  for (const image of images) {
    try {
      const pkg = (await fetchJson(`orgs/${org}/packages/container/${image}`)) as { visibility?: unknown };
      if (pkg?.visibility !== 'public') bad.push(`${image} (private)`);
    } catch {
      bad.push(`${image} (missing or unreadable)`);
    }
  }
  return bad;
}
```

`preconditions.ts`: add to `ReleaseFacts`:

```ts
  /** Third-party GHCR copies an install pulls that are missing or private. One 401 aborts the
   *  whole `docker compose pull`. */
  thirdPartyUnavailable: string[];
```

and in `evaluatePreconditions`, before the changelog check:

```ts
  if (f.thirdPartyUnavailable.length > 0) {
    refusals.push(
      `third-party image copies not pullable: ${f.thirdPartyUnavailable.join(', ')}. ` +
        'Make each public in the GitHub package settings, or run pnpm images:mirror',
    );
  }
```

`scripts/release.ts`: import `findUnavailablePackages`, `parseThirdPartyList` from the release
package path already used for the other imports, read the list, and add to `facts`:

```ts
    thirdPartyUnavailable: await findUnavailablePackages(
      ghJson, OWNER,
      parseThirdPartyList(readFileSync(join(repoRoot, 'deploy/third-party-images.json'), 'utf8')).images.map((i) => i.name),
    ),
```

- [ ] **Step 3: Run tests and typecheck**

```bash
pnpm --filter @openldr/release test > "$TEMP/rel.txt" 2>&1; echo "test exit=$?"; pnpm --filter @openldr/release typecheck > "$TEMP/rtc.txt" 2>&1; echo "tc exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 4: Dry-run check of the release preconditions**

Do not run `pnpm release` here: it refuses on branch and sync anyway. Check the new fact alone:

```bash
npx tsx -e "import { findUnavailablePackages, parseThirdPartyList } from './packages/release/src/index.ts'; import { readFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process'; const gh = async (p: string) => JSON.parse(execFileSync('gh', ['api', p], { encoding: 'utf8' })); console.log(await findUnavailablePackages(gh, 'Open-Laboratory-Data-Repository', parseThirdPartyList(readFileSync('deploy/third-party-images.json','utf8')).images.map(i => i.name)));"
```

Expected: `[]` once Task 6 Step 3 is done.

- [ ] **Step 5: Commit**

```bash
git add packages/release/src/preconditions.ts packages/release/src/preconditions.test.ts packages/release/src/registry.ts packages/release/src/registry.test.ts scripts/release.ts
git commit -m "feat(release): refuse when a third-party image copy is missing or private"
```

---

### Task 9: Docs in en, fr and pt

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/environment.md` (the object storage section and
  the `BLOB_ADAPTER` row)
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/upgrading.md`
- Modify: `apps/studio/src/docs/0.1.8/en/cli.md` if it exists, else the CLI page that lists
  `target-store` commands (find with `grep -rln "target-store" apps/studio/src/docs/0.1.8/en`)
- Modify: `apps/web/src/docs/0.1.8/{environment,upgrading,development,cli}.md`

Each locale gets the same content, translated. Run `unslop` over the English before translating.

- [ ] **Step 1: environment.md**

Rename the heading `Object storage (S3 / MinIO)` to `Object storage (S3)`. Replace the intro
sentence with: "The bundled `storage` service runs Garage, an S3-compatible server. Point these
at any S3 endpoint to use another one." Change the `S3_ENDPOINT` default to
`http://storage:3900`. Change the `S3_FORCE_PATH_STYLE` note from "required by MinIO" to
"required by the bundled storage". Add two rows:

| Variable | Default | What it does |
|---|---|---|
| `GARAGE_RPC_SECRET` | generated | Garage's internal secret, 64 hex characters. |
| `GARAGE_ADMIN_TOKEN` | generated | Garage's admin API token, 64 hex characters. |

Add one sentence under the table: "Garage only accepts an access key ID of `GK` followed by 24
hex characters, and a 64-character hex secret. The installer generates both."

- [ ] **Step 2: upgrading.md, MinIO to Garage section**

Replace every other MinIO mention with "the storage service". Add a section:

```md
## Moving from MinIO to Garage (installs from before 0.1.10)

MinIO removed its images from Docker Hub on 2026-09-11. From 0.1.10 the `storage` service runs
Garage instead. An install that already holds files must copy them across once. A fresh install
does not need this.

1. Note the current MinIO key and secret from `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
2. Back up `.env` and `docker-compose.yml`.
3. Download the 0.1.10 `docker-compose.yml` and `config/garage.toml`. Add the old `minio`
   service back into `docker-compose.yml` from your backup, so MinIO keeps running beside Garage.
4. Generate new values and write them to `.env`:
   - `S3_ACCESS_KEY_ID`: `GK` followed by 24 hex characters (`echo GK$(openssl rand -hex 12)`)
   - `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`: 64 hex characters each
     (`openssl rand -hex 32`)
   - `S3_ENDPOINT=http://storage:3900`
5. Start the new services: `docker compose up -d storage api`.
6. Copy the files:
   `./openldr storage copy --from-endpoint http://minio:9000 --from-key <old key> --from-secret <old secret> --from-bucket openldr`
   It prints object counts and bytes for both sides and exits non-zero if they differ. Run it
   again to resume after a failure. It never changes MinIO.
7. When it reports `totals match`, open a few uploaded files in the studio.
8. Remove the `minio` service from `docker-compose.yml` and run `docker compose up -d --remove-orphans`.
   Keep the `miniodata` volume until you are sure. Then delete it with
   `docker volume rm <project>_miniodata`.
```

Add a second section:

```md
## When a third-party image disappears

Every third-party image an install pulls comes from the OpenLDR copy on GHCR, pinned by digest.
The list is `deploy/third-party-images.json`. If a vendor removes an image, existing installs
and new installs keep working, because the copy stays.

To replace a vendor:

1. Pick a replacement that speaks the same protocol.
2. Add it to `deploy/third-party-images.json` and run `pnpm images:mirror <name>`.
3. Make the new GHCR package public in its settings page.
4. Swap it in behind the same compose service name.
5. If the data format differs, move the data. The MinIO to Garage section above is the worked
   example.
```

- [ ] **Step 3: CLI page**

Add `openldr storage copy` with its flags, matching the table style of the `target-store`
entry on that page.

- [ ] **Step 4: Web docs**

Apply Steps 1 to 3 to `apps/web/src/docs/0.1.8/environment.md`, `upgrading.md` and `cli.md`
(English only, as those files are). In `development.md` replace MinIO with "the storage service
(Garage)" and add: "If your `.env` predates 0.1.10, change `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` to the values in `.env.example`."

- [ ] **Step 5: Check no MinIO mention is left except the move section**

```bash
git grep -n -i "minio" -- apps/studio/src/docs/0.1.8 apps/web/src/docs/0.1.8
```

Expected: hits only inside the "Moving from MinIO to Garage" sections and the development note.

- [ ] **Step 6: Run the docs tests**

```bash
pnpm --filter @openldr/studio exec vitest run src/docs > "$TEMP/docs.txt" 2>&1; echo "exit=$?"; pnpm --filter @openldr/web test > "$TEMP/web.txt" 2>&1; echo "exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/docs/0.1.8 apps/web/src/docs/0.1.8
git commit -m "docs: Garage storage, moving from MinIO, and what to do when an image disappears"
```

---

### Task 10: Rehearse the MinIO to Garage copy locally

**Files:** none. This is the live check unit tests cannot give.

- [ ] **Step 1: Seed a throwaway MinIO and a throwaway Garage**

MinIO's image is still cached on this machine (`minio/minio:latest`, built 2025-09-07).

```bash
export MSYS_NO_PATHCONV=1
docker network create copy-rehearsal
docker run -d --name reh-minio --network copy-rehearsal -p 39100:9000 -e MINIO_ROOT_USER=rehearse -e MINIO_ROOT_PASSWORD=rehearse123 minio/minio:latest server /data
docker run -d --name reh-storage --network copy-rehearsal -p 39200:3900 -v "$PWD/deploy/install/garage.toml:/etc/garage.toml:ro" -e GARAGE_RPC_SECRET=$(openssl rand -hex 32) -e GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32) -e GARAGE_DEFAULT_ACCESS_KEY=GK$(printf 'a%.0s' $(seq 1 24)) -e GARAGE_DEFAULT_SECRET_KEY=$(printf 'b%.0s' $(seq 1 64)) -e GARAGE_DEFAULT_BUCKET=openldr "$(node -e "const l=require('./deploy/third-party-images.json');const g=l.images.find(i=>i.name==='garage');console.log(g.copy+'@'+g.digest)")" /garage server --single-node --default-bucket
```

Then write a script in the scratchpad that uses `createS3Bucket` against MinIO on 39100 to create
bucket `openldr` (use `CreateBucketCommand`) and put 1,200 small objects plus one 12 MB object.

- [ ] **Step 2: Run the real command**

```bash
S3_ENDPOINT=http://localhost:39200 S3_ACCESS_KEY_ID=GKaaaaaaaaaaaaaaaaaaaaaaaa S3_SECRET_ACCESS_KEY=$(printf 'b%.0s' $(seq 1 64)) S3_BUCKET=openldr pnpm --filter @openldr/cli exec tsx src/index.ts storage copy --from-endpoint http://localhost:39100 --from-key rehearse --from-secret rehearse123 --from-bucket openldr
```

The CLI's `loadConfig` needs the rest of a valid config. Run it from the worktree with the dev
`.env` loaded and only the four S3 values overridden as above.
Expected: `source: 1201 objects`, `target: 1201 objects`, `totals match`, exit 0.

- [ ] **Step 3: Run it again**

Expected: `copied 0, skipped 1201 already present`, `totals match`.

- [ ] **Step 4: Read the 12 MB object back from Garage through `createS3Bucket`**

Expected: byte length 12,582,912 and the same bytes written.

- [ ] **Step 5: Clean up**

```bash
docker rm -f reh-minio reh-storage && docker network rm copy-rehearsal
```

Record the three outputs for the final report.

---

### Task 11: Gate, merge, push, changelog

- [ ] **Step 1: Full gate**

```bash
pnpm turbo run test --force --concurrency=2 --continue > "$TEMP/gate-test.txt" 2>&1; echo "test exit=$?"; pnpm turbo run typecheck --force --concurrency=2 > "$TEMP/gate-tc.txt" 2>&1; echo "tc exit=$?"; grep -E "Tasks:|Failed:" "$TEMP/gate-test.txt" "$TEMP/gate-tc.txt"; grep -ciE "out of memory|VirtualAlloc|Test timed out" "$TEMP/gate-test.txt"
```

Expected: both `exit=0`, `0 cached`. On a failure, grep for timeouts and memory first, and
re-run that package alone before calling it a regression.

- [ ] **Step 2: Lint the server**

`pnpm --filter @openldr/server lint > "$TEMP/lint.txt" 2>&1; echo "exit=$?"`. Expected: `exit=0`.

- [ ] **Step 3: Merge to local main and push**

From the main checkout. Another session may be working on `main`, so check first:

```bash
cd /d/Projects/Repositories/openldr_ce && git status --short && git fetch -q origin && git rev-list --left-right --count origin/main...main
```

Expected: clean tree and `0	0`. Then:

```bash
git merge --no-ff feat/garage-storage -m "Merge branch 'feat/garage-storage': Garage storage and GHCR copies of third-party images" && git push origin main && git rev-parse HEAD origin/main
```

Expected: both SHAs equal.

- [ ] **Step 4: Changelog**

```bash
pnpm make:changelog && git add apps/web/src/landing/changelog.json && git commit -m "chore(web): update changelog after the Garage storage switch" && git push origin main && git rev-parse HEAD origin/main
```

---

### Task 12: Release 0.1.10

- [ ] **Step 1: Bump**

Set `"version": "0.1.10"` in `package.json`, `apps/server/package.json`,
`apps/studio/package.json`, `apps/web/package.json`, `packages/cli/package.json`. Run
`pnpm install` once. Commit `chore(release): 0.1.10` and push. Confirm the origin SHA.

- [ ] **Step 2: Dry run, then release**

```bash
pnpm release --dry-run > "$TEMP/rel-dry.txt" 2>&1; echo "exit=$?"; grep -E "refusing|preconditions clear|released" "$TEMP/rel-dry.txt"
pnpm release > "$TEMP/rel.txt" 2>&1; echo "exit=$?"; grep -E "pushing manifest for|confirmed public|verification install|released|refusing|Error" "$TEMP/rel.txt"
```

Expected: `preconditions clear`, ten `pushing manifest` lines, `all five packages confirmed public`,
the verification install passing with `--require-ready`, `released 0.1.10`.

- [ ] **Step 3: Check the published release**

`gh release view v0.1.10` shows the release with `latest.json`. Fetch
`https://github.com/Open-Laboratory-Data-Repository/openldr/releases/download/v0.1.10/latest.json`
directly. Do not judge it by `releases/latest/download`, which lags.

---

### Task 13: Move the droplet to Garage

Host `root@104.236.254.103`, install at `/root/openldr`. SSH with
`"/c/Program Files/PuTTY/plink.exe" -batch -ssh root@104.236.254.103 '<cmd>'` from the Bash tool,
single-quoting the remote command.

- [ ] **Step 1: Record the starting state**

Object count and bytes in MinIO, running image digests, `md5sum config/nginx/certs/*.pem`,
`grep -c . .env`. Use `docker compose exec -T api node /app/cli/dist/index.js health --json`
inside `sh -c '...'` on the remote side.

- [ ] **Step 2: Back up**

`cp docker-compose.yml docker-compose.yml.bak-pre-garage && cp .env .env.bak-pre-garage`.

- [ ] **Step 3: New compose and config, MinIO kept**

Download the 0.1.10 `deploy/install/docker-compose.yml` and `deploy/install/garage.toml` from
the `v0.1.10` tag. Copy the `minio` service block from the backup back into the new compose, and
`miniodata:` back into `volumes:`.

- [ ] **Step 4: New keys in `.env`**

Save the old `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` to `/root/minio-old-keys` (mode 600).
Write a new `S3_ACCESS_KEY_ID=GK$(openssl rand -hex 12)`, `S3_SECRET_ACCESS_KEY`,
`GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` (`openssl rand -hex 32` each), and
`S3_ENDPOINT=http://storage:3900`.

- [ ] **Step 5: Pull and start**

`docker compose pull && docker compose up -d`. Wait for `storage` and `api` healthy.

- [ ] **Step 6: Copy**

`./openldr storage copy --from-endpoint http://minio:9000 --from-key <old> --from-secret <old> --from-bucket openldr`.
Expected: totals match and equal Step 1's MinIO count. Stop if they differ.

- [ ] **Step 7: Verify through the app**

Public checks without `-k`: `/`=200, `/studio/`=200, `/api/config` reports `"version":"0.1.10"`,
`/api/health`=401. Read one existing object through the api (from inside the api container,
`openldr health --json` shows blob `up`). Cert md5 unchanged.

- [ ] **Step 8: Remove MinIO, keep its volume**

Remove the `minio` service block, run `docker compose up -d --remove-orphans`. Leave the
`miniodata` volume and `/root/minio-old-keys`. Report both to the operator for a later delete.

---

## Not in this plan

- Deleting the private GHCR `minio` and `mc` stopgap packages. It needs the operator to run
  `gh auth refresh -h github.com -s delete:packages` first.
- Testers' own installs. They follow the upgrading guide, or reinstall fresh.
- Watching for upstream security updates to the copied images.
