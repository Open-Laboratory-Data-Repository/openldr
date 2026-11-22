import { createAppContext, formOpenRule, type EntryViewer } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import type { FormEntry, FormEntryStatus } from '@openldr/db';
import { cliActor } from './cli-actor';
import { servedCaller } from './served-caller';

// `openldr forms entries` and `openldr forms void-entry` (design 2026-11-22-form-entries). They call
// the same entries service as GET /api/forms/:id/entries and POST /api/forms/entries/:entryId/void,
// with the same checks. A served run is the signed-in caller: their data limit and their form access
// apply, and the server has already checked the capability (command-meta.ts). A local run is the
// operator on the box: no data limit, and every form is open.

type AppCtx = Awaited<ReturnType<typeof createAppContext>>;

const STATUSES: readonly FormEntryStatus[] = ['active', 'incomplete', 'entered-in-error'];
const MAX_REASON = 500;
const NOT_FOUND = 'entry not found';

/** The caller as the entries rules see them, and whether a form is open to them. Null when a served
 *  caller cannot be found, who then sees nothing. */
async function callerOf(ctx: AppCtx): Promise<{ viewer: EntryViewer; openable(formIds: string[]): Promise<Set<string>> } | null> {
  const caller = await servedCaller(ctx);
  if (caller === 'local') return { viewer: { id: '', dataScope: { limited: false } }, openable: async (ids) => new Set(ids) };
  if (!caller) return null;
  const rule = formOpenRule(ctx.formAccess);
  return { viewer: { id: caller.id, dataScope: caller.dataScope }, openable: (ids) => rule.openable(caller, ids) };
}

/** A whole number in [min, max], or null. */
function intIn(text: string, min: number, max: number): number | null {
  if (!/^-?\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

const summaryText = (e: FormEntry): string => e.summary.map((s) => `${s.label}: ${s.value}`).join('; ');

export async function runFormsEntries(
  form: string,
  opts: { json: boolean; status?: string; limit: string; offset: string },
): Promise<number> {
  if (opts.status !== undefined && !STATUSES.includes(opts.status as FormEntryStatus)) {
    process.stderr.write(`--status must be one of ${STATUSES.join(', ')}\n`);
    return 1;
  }
  const limit = intIn(opts.limit, 1, 100);
  const offset = intIn(opts.offset, 0, Number.MAX_SAFE_INTEGER);
  if (limit === null) { process.stderr.write('--limit must be a whole number from 1 to 100\n'); return 1; }
  if (offset === null) { process.stderr.write('--offset must be a whole number, 0 or more\n'); return 1; }

  const ctx = await createAppContext(loadConfig());
  try {
    const caller = await callerOf(ctx);
    // Only forms open to the caller are matched, so a name never reveals a form they may not open.
    const all = await ctx.forms.list();
    const open = caller ? await caller.openable(all.map((f) => f.id)) : new Set<string>();
    const forms = all.filter((f) => open.has(f.id));
    const byId = forms.find((f) => f.id === form);
    const byName = byId ? [byId] : forms.filter((f) => f.name === form);
    if (!caller || byName.length === 0) {
      process.stderr.write(`no form ${form}\n`);
      return 1;
    }
    if (byName.length > 1) {
      process.stderr.write(`more than one form is named ${form}: ${byName.map((f) => f.id).join(', ')}. Give the id.\n`);
      return 1;
    }

    const result = await ctx.formEntries.list({
      formId: byName[0]!.id, user: caller.viewer, limit, offset,
      ...(opts.status ? { status: opts.status as FormEntryStatus } : {}),
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return 0;
    }
    if (result.entries.length === 0) {
      process.stdout.write(`(no entries; ${result.total} in all)\n`);
      return 0;
    }
    const lines = [
      'requisition\tstatus\tentered at\tby\tfacility code\tsummary',
      ...result.entries.map((e) => `${e.entryKey ?? ''}\t${e.status}\t${e.enteredAt}\t${e.enteredByName}\t${e.facilityCode ?? ''}\t${summaryText(e)}`),
      `showing ${offset + 1} to ${offset + result.entries.length} of ${result.total}`,
    ];
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}

/**
 * Mark one entry as entered in error. It frees the requisition number and saves the entry's records
 * again with that status, so it refuses without --force and then only shows the entry.
 */
export async function runFormsVoidEntry(
  id: string,
  opts: { json: boolean; force: boolean; reason: string },
): Promise<number> {
  const reason = opts.reason.trim();
  if (reason.length < 1 || reason.length > MAX_REASON) {
    process.stderr.write(`a reason of 1 to ${MAX_REASON} characters is required\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const caller = await callerOf(ctx);
    // As the route: an entry of a form the caller may not open is not there.
    const seen = caller ? await ctx.formEntries.get(id, caller.viewer) : null;
    if (!caller || !seen || !(await caller.openable([seen.formId])).has(seen.formId)) {
      process.stderr.write(`${NOT_FOUND}\n`);
      return 1;
    }
    if (!opts.force) {
      if (opts.json) {
        process.stdout.write(JSON.stringify(seen, null, 2) + '\n');
      } else {
        process.stdout.write([
          `requisition: ${seen.entryKey ?? ''}`,
          `status: ${seen.status}`,
          `entered at: ${seen.enteredAt}`,
          `by: ${seen.enteredByName}`,
          `summary: ${summaryText(seen)}`,
        ].join('\n') + '\n');
      }
      process.stderr.write('use --force to mark it as entered in error\n');
      return 1;
    }

    const result = await ctx.formEntries.voidEntry({ entryId: id, reason, user: caller.viewer, actor: cliActor() });
    if (result === 'not-found') {
      process.stderr.write(`${NOT_FOUND}\n`);
      return 1;
    }
    if (result === 'already-void') {
      process.stderr.write('already marked as entered in error\n');
      return 1;
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return 0;
    }
    const lines = [`marked ${id} as entered in error`];
    if (result.warning) lines.push(result.warning);
    lines.push(`resaved ${result.resaved}, skipped ${result.skipped}`);
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}
