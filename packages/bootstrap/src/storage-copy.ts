import type { CopySide } from '@openldr/adapter-s3-bucket';

export interface StorageCopyReport {
  sourceObjects: number;
  sourceBytes: number;
  copied: number;
  skipped: number;
  targetObjects: number;
  targetBytes: number;
  /** Keys on the target that are not in the source. The api keeps writing while a live copy
   *  runs, so a few are normal. They never fail the run. */
  extraTargetObjects: number;
  /** Source keys that are absent from the target, or there at a different size, after the copy. */
  missing: number;
  /** True when every source key is on the target at the same size. */
  matches: boolean;
}

/** Copy every object from `source` to `target`. Shared by the `openldr storage copy` command.
 *
 *  An object already on the target at the same size is skipped, so a run that died part-way
 *  resumes instead of starting over. The source is only read. After the copy the target is
 *  listed once and each source key is checked against that listing, so `matches` describes what
 *  is actually there. Extra objects on the target are counted but do not fail the run. */
export async function copyStorage(
  source: CopySide,
  target: CopySide,
  onProgress?: (done: number, key: string) => void,
): Promise<StorageCopyReport> {
  const sourceSizes = new Map<string, number>();
  let sourceBytes = 0;
  let copied = 0;
  let skipped = 0;
  for await (const o of source.list()) {
    sourceSizes.set(o.key, o.size);
    sourceBytes += o.size;
    if ((await target.sizeOf(o.key)) === o.size) {
      skipped += 1;
    } else {
      const { body, contentType } = await source.read(o.key);
      await target.write(o.key, body, contentType);
      copied += 1;
    }
    onProgress?.(sourceSizes.size, o.key);
  }
  const targetSizes = new Map<string, number>();
  let targetBytes = 0;
  for await (const o of target.list()) {
    targetSizes.set(o.key, o.size);
    targetBytes += o.size;
  }
  let missing = 0;
  for (const [key, size] of sourceSizes) {
    if (targetSizes.get(key) !== size) missing += 1;
  }
  let extraTargetObjects = 0;
  for (const key of targetSizes.keys()) {
    if (!sourceSizes.has(key)) extraTargetObjects += 1;
  }
  return {
    sourceObjects: sourceSizes.size,
    sourceBytes,
    copied,
    skipped,
    targetObjects: targetSizes.size,
    targetBytes,
    extraTargetObjects,
    missing,
    matches: missing === 0,
  };
}
