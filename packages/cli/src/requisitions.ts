import { loadConfig } from '@openldr/config';
import { createAppContext, recordAuditEvent } from '@openldr/bootstrap';
import { rebuildRequisitions } from '@openldr/db';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr lab requisitions rebuild`: repairs the index that finds an order by its requisition
// number (migration 139, lab-requisitions.ts). It has no route. In served mode it needs
// settings.danger_zone (command-meta.ts), as the other whole-table repairs do.

type Opts = { json: boolean };

function fail(command: string, message: string, json: boolean): number {
  if (json) process.stdout.write(JSON.stringify({ error: message }) + '\n');
  else process.stderr.write(`${command} failed: ${message}\n`);
  return 1;
}

/** `openldr lab requisitions rebuild --force`: indexes every current ServiceRequest by its
 *  requisition number again, writing over the rows already there (the same fill migration 139 runs),
 *  then removes the rows that fill did not touch and the rows of requests no longer in the store.
 *  The projection keeps the table current, so this is for repair: after a hook failure, or to drop
 *  the rows of deleted requests. It rewrites the whole table, so it refuses without --force. */
export async function runLabRequisitionsRebuild(opts: Opts & { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write('Refusing to rebuild the requisition index without --force.\n');
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const { indexed } = await rebuildRequisitions(ctx.internalDb);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'lab.requisitions.rebuild', entityType: 'lab_requisitions', entityId: 'lab_requisitions', metadata: { indexed },
    });
    process.stdout.write(opts.json ? JSON.stringify({ indexed }) + '\n' : `Indexed ${indexed} orders by requisition number.\n`);
    return 0;
  } catch (err) {
    return fail('lab requisitions rebuild', redactError(err), opts.json);
  } finally {
    await ctx.close();
  }
}
