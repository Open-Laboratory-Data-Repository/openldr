import { loadConfig, LAB_ALLOW_SELF_AUTHORISE_KEY } from '@openldr/config';
import { createAppContext, recordAuditEvent } from '@openldr/bootstrap';
import { rebuildRequisitions } from '@openldr/db';
import { callerName, cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr lab ...`: the CLI doors to the lab-wide settings on Settings ▸ Laboratory and to a test's
// section and review setting. Each calls the service the matching route calls and records the same
// audit action, as the CLI actor (AGENTS.md section 6). In served mode each needs lab.settings
// (command-meta.ts).

type Opts = { json: boolean };

function fail(command: string, message: string, json: boolean): number {
  if (json) process.stdout.write(JSON.stringify({ error: message }) + '\n');
  else process.stderr.write(`${command} failed: ${message}\n`);
  return 1;
}

/** Parse 'true' or 'false', the only two words these commands take for a switch. */
function parseSwitch(value: string): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** `openldr lab sections list`: GET /api/settings/lab/sections. */
export async function runLabSectionsList(opts: Opts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.labSections.listSections();
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else process.stdout.write((rows.length ? rows.map((s) => `${s.code}\t${s.name}`).join('\n') : '(no sections)') + '\n');
    return 0;
  } catch (err) {
    return fail('lab sections list', redactError(err), opts.json);
  } finally {
    await ctx.close();
  }
}

/** `openldr lab sections add <code> <name>`: POST /api/settings/lab/sections. */
export async function runLabSectionsAdd(code: string, name: string, opts: Opts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const section = await ctx.labSections.addSection(code, name);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'settings.lab.section.add', entityType: 'lab_section', entityId: section.code, after: section,
    });
    process.stdout.write(opts.json ? JSON.stringify(section, null, 2) + '\n' : `Added section ${section.code} (${section.name}).\n`);
    return 0;
  } catch (err) {
    return fail('lab sections add', redactError(err), opts.json);
  } finally {
    await ctx.close();
  }
}

/** `openldr lab sections remove <code> --force`: DELETE /api/settings/lab/sections/:code. It cannot
 *  be undone, so it refuses without --force. The service refuses a section a test still uses. */
export async function runLabSectionsRemove(code: string, opts: Opts & { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write(`Refusing to remove section ${code} without --force.\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = (await ctx.labSections.listSections()).find((s) => s.code === code) ?? null;
    await ctx.labSections.removeSection(code);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'settings.lab.section.remove', entityType: 'lab_section', entityId: code, before,
    });
    process.stdout.write(opts.json ? JSON.stringify({ removed: code }) + '\n' : `Removed section ${code}.\n`);
    return 0;
  } catch (err) {
    return fail('lab sections remove', redactError(err), opts.json);
  } finally {
    await ctx.close();
  }
}

export interface LabTestsSetOpts extends Opts {
  /** A section code from --section, false from --no-section, undefined when neither was given. */
  section?: string | boolean;
  needsReview?: string;
}

/** `openldr lab tests set <code>`: the section and review fields of PUT /api/test-catalog/:code/lab,
 *  through the same setLabSettings. A field left out keeps what is stored. */
export async function runLabTestsSet(code: string, opts: LabTestsSetOpts): Promise<number> {
  const input: { section?: string | null; needsReview?: boolean } = {};
  if (typeof opts.section === 'string') input.section = opts.section;
  else if (opts.section === false) input.section = null;
  if (opts.needsReview !== undefined) {
    const v = parseSwitch(opts.needsReview);
    if (v === null) return fail('lab tests set', '--needs-review must be true or false', opts.json);
    input.needsReview = v;
  }
  if (input.section === undefined && input.needsReview === undefined) {
    return fail('lab tests set', 'pass --section <code>, --no-section or --needs-review true|false', opts.json);
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = (await ctx.testCatalog.get(code))?.lab ?? null;
    const saved = await ctx.testCatalog.setLabSettings(code, input);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'test_catalog.lab_settings', entityType: 'test_catalog', entityId: code, before, after: saved.lab,
    });
    const section = saved.lab.section ? `section ${saved.lab.section}` : 'no section';
    process.stdout.write(opts.json
      ? JSON.stringify(saved, null, 2) + '\n'
      : `${code}: ${section}, needs review ${saved.lab.needsReview ? 'yes' : 'no'}.\n`);
    return 0;
  } catch (err) {
    return fail('lab tests set', redactError(err), opts.json);
  } finally {
    await ctx.close();
  }
}

const LAB_SETTINGS = ['allow-self-authorise'] as const;

/** `openldr lab settings set allow-self-authorise true|false`: PUT /api/settings/lab/allow-self-authorise. */
export async function runLabSettingsSet(key: string, value: string, opts: Opts): Promise<number> {
  if (!(LAB_SETTINGS as readonly string[]).includes(key)) {
    return fail('lab settings set', `unknown setting ${key} (known: ${LAB_SETTINGS.join(', ')})`, opts.json);
  }
  const v = parseSwitch(value);
  if (v === null) return fail('lab settings set', `${key} must be true or false`, opts.json);
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.labIdentity.allowSelfAuthorise();
    await ctx.labIdentity.setAllowSelfAuthorise(v, callerName());
    const after = await ctx.labIdentity.allowSelfAuthorise();
    await recordAuditEvent(ctx, cliActor(), {
      action: 'settings.lab.allow_self_authorise', entityType: 'settings', entityId: LAB_ALLOW_SELF_AUTHORISE_KEY,
      before: { value: before }, after: { value: after },
    });
    process.stdout.write(opts.json ? JSON.stringify({ [key]: after }) + '\n' : `${key} is now ${after}.\n`);
    return 0;
  } catch (err) {
    return fail('lab settings set', redactError(err), opts.json);
  } finally {
    await ctx.close();
  }
}

/** `openldr lab requisitions rebuild --force`: empties `lab_requisitions` and indexes every current
 *  ServiceRequest by its requisition number again, the same fill migration 139 runs. The projection
 *  keeps the table current, so this is for repair: after a hook failure, or to drop the rows of
 *  requests deleted from the store. It rewrites the whole table, so it refuses without --force. */
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
