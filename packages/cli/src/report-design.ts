import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import type { ReportDesignStore } from '@openldr/report-designer';

type Writer = (s: string) => void;
const stdout: Writer = (s) => process.stdout.write(s);

// ── Pure handlers (store injected → unit-testable) ──────────────────────────
export async function listDesigns(store: ReportDesignStore, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const designs = await store.list();
  if (opts.json) { write(JSON.stringify(designs, null, 2) + '\n'); return; }
  const lines = designs.map((d) => `${d.id}\t${d.name}\t${d.paper}\t${d.orientation}\t${d.pages.length} pages`);
  write((lines.length ? lines.join('\n') : '(no report designs)') + '\n');
}

export async function deleteDesign(store: ReportDesignStore, id: string, opts: { force: boolean }): Promise<void> {
  if (!opts.force) throw new Error('refusing to delete without --force');
  await store.remove(id);
}

export async function publishDesign(store: ReportDesignStore, id: string, write: Writer = stdout): Promise<void> {
  const d = await store.publish(id, 'cli');
  write(`published ${d.id}\n`);
}

export async function listDesignVersions(store: ReportDesignStore, id: string, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const versions = await store.listVersions(id);
  if (opts.json) { write(JSON.stringify(versions, null, 2) + '\n'); return; }
  const lines = versions.map((v) => `v${v.version}\t${v.publishedAt}\t${v.publishedBy ?? '-'}\t${v.name}`);
  write((lines.length ? lines.join('\n') : '(no published versions)') + '\n');
}

// ── Command entrypoints (open a real AppContext) ────────────────────────────
export async function runList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listDesigns(ctx.reportDesigns, opts); return 0; } finally { await ctx.close(); }
}

export async function runDelete(id: string, opts: { force: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await deleteDesign(ctx.reportDesigns, id, opts); process.stdout.write(`deleted ${id}\n`); return 0; } finally { await ctx.close(); }
}

export async function runPublish(id: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await publishDesign(ctx.reportDesigns, id); return 0; } finally { await ctx.close(); }
}

export async function runVersions(id: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listDesignVersions(ctx.reportDesigns, id, opts); return 0; } finally { await ctx.close(); }
}
