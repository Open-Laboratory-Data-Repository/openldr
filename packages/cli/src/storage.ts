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
