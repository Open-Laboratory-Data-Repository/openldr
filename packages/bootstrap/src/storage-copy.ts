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
