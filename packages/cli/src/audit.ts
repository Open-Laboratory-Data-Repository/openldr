import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { AUDIT_COLUMNS } from '@openldr/table-query';
import { parseWhereFlags } from './table-query-flags';

interface ListOpts {
  actor?: string;
  entity?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  where?: string[];
  sort?: string[];
  json: boolean;
}

export async function runAuditList(opts: ListOpts): Promise<number> {
  const parsed = parseWhereFlags(opts.where ?? [], opts.sort ?? [], AUDIT_COLUMNS);
  if (!parsed.ok) {
    process.stderr.write(`audit list failed: ${parsed.error}\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.audit.list({
      actorId: opts.actor,
      entityType: opts.entityType ?? opts.entity,
      entityId: opts.entityId,
      action: opts.action,
      from: opts.from,
      to: opts.to,
      filters: parsed.query.filters.length ? parsed.query.filters : undefined,
      sorts: parsed.query.sorts.length ? parsed.query.sorts : undefined,
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    } else {
      const lines = rows.map((r) => `${r.occurredAt}\t${r.actorName}\t${r.action}\t${r.entityType}\t${r.entityId}`);
      process.stdout.write((lines.length ? lines.join('\n') : '(no events)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
