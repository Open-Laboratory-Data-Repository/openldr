import { writeFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import {
  createAppContext, parseDuplicateListQuery, parsePatientListQuery, parseSystemInput, recordAuditEvent,
  type DuplicateGroup, type PatientIdentifierView, type PatientRow,
} from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr patients ...`: the CLI doors to the patient index routes (patient index spec, section 5).
// Masked by default. --identifiers unmasks and writes the same audit entries the routes write. The
// CLI takes a raw patient id, because the server's refs are sealed under a key only it holds.

function fail(command: string, err: unknown, json: boolean): number {
  const msg = redactError(err);
  if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`patients ${command} failed: ${msg}\n`);
  return 1;
}

const idents = (list: PatientIdentifierView[]) => list.map((i) => `${i.label ?? i.system ?? 'No system'} ${i.value}`).join(', ');
const line = (r: PatientRow) => [
  r.id ?? '', r.name ?? '', r.sex ?? '', r.ageYears === null ? '' : `${r.ageYears}y`, idents(r.identifiers),
  r.managingFacility?.name ?? r.managingFacility?.reference ?? '', r.lastRequestAt ?? '', `${r.requestCount} request(s)`,
].filter((s) => s !== '').join('  ');

export interface PatientsListOpts { search?: string; status?: string; limit?: string; offset?: string; identifiers: boolean; json: boolean }

export async function runPatientsList(opts: PatientsListOpts): Promise<number> {
  const parsed = parsePatientListQuery({ search: opts.search, status: opts.status, limit: opts.limit, offset: opts.offset });
  if (!parsed.ok) { process.stderr.write(`patients list failed: ${parsed.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientIndex.list(parsed.query, { unmask: opts.identifiers });
    if (opts.identifiers) {
      await recordAuditEvent(ctx, cliActor(), { action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { count: out.total } });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const footer = `${out.rows.length} of ${out.total} patient(s)${out.masked ? ' (masked; --identifiers shows names and ids)' : ''}`;
    process.stdout.write([...out.rows.map(line), footer].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('list', err, opts.json); } finally { await ctx.close(); }
}

export async function runPatientsShow(id: string, opts: { identifiers: boolean; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const detail = await ctx.patientIndex.getById(id, { unmask: opts.identifiers });
    if (opts.identifiers) await recordAuditEvent(ctx, cliActor(), { action: 'patients.view', entityType: 'patient', entityId: id });
    const requests = await ctx.patientIndex.requestsById(id, { limit: 200, offset: 0 });
    if (opts.json) { process.stdout.write(JSON.stringify({ ...detail, requests }, null, 2) + '\n'); return 0; }
    const lines = [
      `${detail.name ?? '(no name)'}  ${detail.sex ?? ''}  ${detail.birthDate ?? ''}${detail.ageYears === null ? '' : `  ${detail.ageYears}y`}`,
      `Status: ${detail.active && !detail.replacedByRef ? 'active' : 'merged'}`,
      ...detail.identifiers.map((i) => `${i.label ?? i.system ?? 'No system'}: ${i.value}`),
      ...(detail.phone ? [`Phone: ${detail.phone}`] : []),
      ...(detail.email ? [`Email: ${detail.email}`] : []),
      `Requests (${requests.total}):`,
      ...requests.rows.map((r) => [r.authoredAt ?? 'no date', r.panel ?? '', r.requester ?? '', r.status ?? '', `${r.resultCount} result(s)`].join('  ')),
    ];
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (err) { return fail('show', err, opts.json); } finally { await ctx.close(); }
}

export async function runIdentifierSystemsList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientIdentifierSystems.list({ limit: 200, offset: 0 });
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const lines = out.rows.map((r) => [
      r.system ?? '(no system)', r.label ?? '', `${r.patientCount} patient(s)`,
      r.listColumn ? 'listed' : 'not listed', r.searchable ? 'searched' : 'not searched',
    ].filter((s) => s !== '').join('  '));
    process.stdout.write([...lines, `${out.total} system(s)${out.ownedHere ? '' : ' (labels from central, read-only here)'}`].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('identifier-systems list', err, opts.json); } finally { await ctx.close(); }
}

export interface IdentifierSystemsSetOpts { label?: string; listColumn?: string; searchable?: string; json: boolean }

function onOff(v: string | undefined, flag: string): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === 'on') return { ok: true, value: true };
  if (v === 'off') return { ok: true, value: false };
  return { ok: false, error: `${flag} must be on or off` };
}

export async function runIdentifierSystemsSet(system: string, opts: IdentifierSystemsSetOpts): Promise<number> {
  const list = onOff(opts.listColumn, '--list-column');
  const search = onOff(opts.searchable, '--searchable');
  for (const r of [list, search]) if (!r.ok) { process.stderr.write(`patients identifier-systems set failed: ${r.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.patientIdentifierSystems.get(system.trim());
    const parsed = parseSystemInput({
      system,
      label: opts.label !== undefined ? opts.label : before?.labelSource === 'operator' ? before.label : null,
      listColumn: (list.ok && list.value !== undefined) ? list.value : before?.listColumn ?? false,
      searchable: (search.ok && search.value !== undefined) ? search.value : before?.searchable ?? true,
    });
    if (!parsed.ok) { process.stderr.write(`patients identifier-systems set failed: ${parsed.error}\n`); return 1; }
    const after = await ctx.patientIdentifierSystems.set(parsed.input);
    await recordAuditEvent(ctx, cliActor(), { action: 'patients.identifier_system.update', entityType: 'patient_identifier_system', entityId: parsed.input.system, before, after });
    process.stdout.write(opts.json ? JSON.stringify(after, null, 2) + '\n' : `${after.system} saved as ${after.label ?? '(no label)'}.\n`);
    return 0;
  } catch (err) { return fail('identifier-systems set', err, opts.json); } finally { await ctx.close(); }
}

// `openldr patients duplicates ...`: likely duplicate groups (patient duplicate detection spec). CE
// lists them; the source system fixes them. Masked unless --identifiers, which audits the count.
// Dismiss, restore and export audit; export writes CSV that is unmasked.

export interface DuplicatesListOpts { status?: string; limit?: string; offset?: string; identifiers: boolean; json: boolean }

const ruleText = (g: DuplicateGroup) => (g.rule === 'identifier' ? `Same ${g.evidence.label ?? g.evidence.system ?? 'identifier'}` : 'Same name and date of birth');

export async function runDuplicatesList(opts: DuplicatesListOpts): Promise<number> {
  const parsed = parseDuplicateListQuery({ status: opts.status, limit: opts.limit, offset: opts.offset });
  if (!parsed.ok) { process.stderr.write(`patients duplicates list failed: ${parsed.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientDuplicates.list(parsed.query, { unmask: opts.identifiers });
    if (opts.identifiers) await recordAuditEvent(ctx, cliActor(), { action: 'patients.duplicate.list', entityType: 'patient', entityId: 'duplicates', metadata: { count: out.total } });
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const lines = out.rows.map((g) => [
      ruleText(g), g.evidence.text, `${g.memberCount} patient(s)`, `${g.dismissedPairs} of ${g.pairs} pair(s) dismissed`,
      ...(opts.identifiers ? [g.members.map((m) => m.id).join(' ')] : []),
    ].join('  '));
    process.stdout.write([...lines, `${out.rows.length} of ${out.total} group(s)${out.masked ? ' (masked; --identifiers shows names and ids)' : ''}`].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('duplicates list', err, opts.json); } finally { await ctx.close(); }
}

export async function runDuplicatesDismiss(idA: string, idB: string, opts: { reason?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const actor = cliActor();
    const reason = opts.reason?.trim() || null;
    const out = await ctx.patientDuplicates.dismiss({ ids: [idA, idB], reason, by: actor.actorName });
    await recordAuditEvent(ctx, actor, { action: 'patients.duplicate.dismiss', entityType: 'patient', entityId: idA, metadata: { ids: [idA, idB], reason, changed: out.changed } });
    process.stdout.write(opts.json ? JSON.stringify(out) + '\n' : `${out.changed} pair(s) dismissed.\n`);
    return 0;
  } catch (err) { return fail('duplicates dismiss', err, opts.json); } finally { await ctx.close(); }
}

export async function runDuplicatesRestore(idA: string, idB: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientDuplicates.restore({ ids: [idA, idB] });
    await recordAuditEvent(ctx, cliActor(), { action: 'patients.duplicate.restore', entityType: 'patient', entityId: idA, metadata: { ids: [idA, idB], changed: out.changed } });
    process.stdout.write(opts.json ? JSON.stringify(out) + '\n' : `${out.changed} pair(s) restored.\n`);
    return 0;
  } catch (err) { return fail('duplicates restore', err, opts.json); } finally { await ctx.close(); }
}

export async function runDuplicatesExport(opts: { out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const { csv, groups } = await ctx.patientDuplicates.exportCsv();
    await recordAuditEvent(ctx, cliActor(), { action: 'patients.duplicate.export', entityType: 'patient', entityId: 'duplicates', metadata: { groups } });
    if (opts.out) writeFileSync(opts.out, csv, 'utf8'); else process.stdout.write(csv);
    return 0;
  } catch (err) { return fail('duplicates export', err, false); } finally { await ctx.close(); }
}
