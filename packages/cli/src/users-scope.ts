import { createAppContext, DataScopeError, readScopeRegistryRows, recordAuditEvent, setUserDataScope } from '@openldr/bootstrap';
import type { DataScope } from '@openldr/db';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

export interface UsersScopeOpts {
  json: boolean;
  all: boolean;
  force: boolean;
  /** Limited with nothing listed: the user sees no dashboard numbers (review C1). */
  none?: boolean;
  /** Register facility ids, comma separated. */
  facility?: string;
  /** Region/District pairs, comma separated. */
  district?: string;
  /** Regions, comma separated. */
  region?: string;
}

const list = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Show or set a user's data limit (roles part 3). With no option it shows it. `--all` sets
 * Everything. `--facility`, `--district Region/District` and `--region` set Limited to those places,
 * and `--none` sets Limited with nothing listed. Both take permissions away, so they need `--force`. The subject is the user's role subject, as
 * the Users sheet sends it. The route and this command call the same setter.
 */
export async function runUsersScope(subject: string, opts: UsersScopeOpts): Promise<number> {
  const facilities = list(opts.facility);
  const regions = list(opts.region);
  const districtArgs = list(opts.district);
  const listed = facilities.length + regions.length + districtArgs.length > 0;
  if (opts.all && (listed || opts.none)) {
    process.stderr.write('--all means everything; do not give --none, --facility, --district or --region with it\n');
    return 1;
  }
  if (opts.none && listed) {
    process.stderr.write('--none means nothing listed; do not give --facility, --district or --region with it\n');
    return 1;
  }
  const limiting = listed || opts.none === true;
  const districts: Array<{ region: string; district: string }> = [];
  for (const d of districtArgs) {
    const at = d.indexOf('/');
    if (at <= 0 || at === d.length - 1) {
      process.stderr.write(`district ${d} must be Region/District\n`);
      return 1;
    }
    districts.push({ region: d.slice(0, at).trim(), district: d.slice(at + 1).trim() });
  }
  if (limiting && !opts.force) {
    process.stderr.write('a data limit takes permissions away from this user; add --force to set it\n');
    return 1;
  }

  const ctx = await createAppContext(loadConfig());
  try {
    let scope: DataScope = await ctx.dataScopes.get(subject);
    if (opts.all || limiting) {
      const next: DataScope = opts.all ? { limited: false } : { limited: true, facilities, districts, regions };
      try {
        const { before, after } = await setUserDataScope(ctx, subject, next);
        await recordAuditEvent(ctx, cliActor(), { action: 'user.data_scope.set', entityType: 'user', entityId: subject, before, after });
        scope = after;
      } catch (err) {
        if (!(err instanceof DataScopeError)) throw err;
        process.stderr.write(`${err.message}\n`);
        return 1;
      }
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify({ subject, dataScope: scope }, null, 2) + '\n');
      return 0;
    }
    if (!scope.limited) {
      process.stdout.write(`${subject}: everything\n`);
      return 0;
    }
    const names = new Map((await readScopeRegistryRows(ctx.internalDb)).map((r) => [r.id, r.name]));
    const parts = [
      scope.regions.length ? `regions ${scope.regions.join(', ')}` : '',
      scope.districts.length ? `districts ${scope.districts.map((d) => `${d.district} (${d.region})`).join(', ')}` : '',
      scope.facilities.length ? `facilities ${scope.facilities.map((id) => `${names.get(id) ?? id} (${id})`).join(', ')}` : '',
    ].filter(Boolean);
    process.stdout.write(parts.length
      ? `${subject}: limited to ${parts.join('; ')}\n`
      : `${subject}: limited, with nothing listed, so no dashboard numbers\n`);
    return 0;
  } finally {
    await ctx.close();
  }
}
