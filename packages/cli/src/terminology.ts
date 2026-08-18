import { readFileSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '@openldr/config';
import { createTerminologyContext, resolveCodingSystemId, createRunIngest, runIngestJob, recordAuditEvent } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';
import { validateDistributionImportArgs, isActiveJobConflict } from './distribution-args';
import { runDbReproject } from './db';

function out(json: boolean, obj: unknown, human: string): void {
  process.stdout.write((json ? JSON.stringify(obj, null, 2) : human) + '\n');
}

export async function runTerminologyImport(kind: string, path: string, opts: { acceptLicense?: boolean; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    if (kind === 'loinc') {
      const r = await ctx.loaders.loinc(path, !!opts.acceptLicense);
      out(opts.json, r, `loaded ${r.conceptsLoaded} LOINC concepts`);
      await recordAuditEvent(ctx, cliActor(), { action: 'coding_system.import', entityType: 'coding_system', entityId: 'loinc', metadata: { source: 'loinc', result: r } });
    } else if (kind === 'amr') {
      // No HTTP-twin route for AMR import (grepped terminology-admin-routes.ts / ontology-routes.ts — neither
      // has an amr import audit call). Flagged: using coding_system.import with entityId 'amr' by analogy to loinc.
      const r = await ctx.loaders.amr(path);
      out(opts.json, r, r.map((x) => `${x.system}: ${x.conceptsLoaded}`).join('\n'));
      await recordAuditEvent(ctx, cliActor(), { action: 'coding_system.import', entityType: 'coding_system', entityId: 'amr', metadata: { source: 'amr', result: r } });
    } else if (kind === 'resource') {
      const r = await ctx.loaders.resource(JSON.parse(readFileSync(path, 'utf8')));
      out(opts.json, r, `imported ${r.resourceUrl} (${r.conceptsLoaded} concepts)`);
      await recordAuditEvent(ctx, cliActor(), { action: 'term.import', entityType: 'term', entityId: r.resourceUrl, metadata: { result: r } });
    } else if (kind === 'organisms') {
      // A site's organism dictionary (DISA COMMDICT CONTEXT=50) as a CodeSystem carrying
      // properties.organism_type. Deliberately an IMPORT and not a seed: the dictionary is
      // site-specific, so shipping one deployment's codes as a product default would make every
      // other deployment silently wrong. See importOrganismDictionary's comment.
      const r = await ctx.loaders.organisms(JSON.parse(readFileSync(path, 'utf8')));
      out(opts.json, r, `loaded ${r.conceptsLoaded} organism concepts into ${r.system}\n` +
        Object.entries(r.byType).map(([t, n]) => `  ${t}: ${n}`).join('\n') +
        (r.skipped ? `\n  skipped (no code): ${r.skipped}` : ''));
      await recordAuditEvent(ctx, cliActor(), { action: 'coding_system.import', entityType: 'coding_system', entityId: 'organisms', metadata: { source: 'organisms', result: r } });
    } else if (kind === 'parameters') {
      // A site's result-parameter dictionary (DISA PARMDICT) as a CodeSystem carrying
      // properties.result_role. Deliberately an IMPORT and not a seed: the dictionary is
      // site-specific, so shipping one deployment's codes as a product default would make every
      // other deployment silently wrong. See importResultParameters's comment.
      const r = await ctx.loaders.parameters(JSON.parse(readFileSync(path, 'utf8')));
      out(opts.json, r, `loaded ${r.conceptsLoaded} result parameter concepts into ${r.system}\n` +
        Object.entries(r.byRole).map(([t, n]) => `  ${t}: ${n}`).join('\n') +
        (r.skipped ? `\n  skipped (no code): ${r.skipped}` : ''));
      await recordAuditEvent(ctx, cliActor(), { action: 'coding_system.import', entityType: 'coding_system', entityId: 'parameters', metadata: { source: 'parameters', result: r } });
    } else { process.stderr.write(`unknown import kind '${kind}' (loinc|amr|organisms|parameters|resource)\n`); return 1; }
    return 0;
  } catch (err) { process.stderr.write(`terminology import failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyLookup(system: string, code: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { const r = await ctx.ops.lookup(system, code); out(opts.json, r, r.found ? `${code}: ${r.display}` : `${code} not found`); return r.found ? 0 : 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyValidate(opts: { system?: string; code: string; valueset?: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const r = opts.valueset ? await ctx.ops.validateCode({ valueSetUrl: opts.valueset, code: opts.code }) : await ctx.ops.validateCode({ system: opts.system!, code: opts.code });
    out(opts.json, r, `${r.result}: ${r.message}`); return r.result ? 0 : 1;
  } finally { await ctx.close(); }
}

export async function runTerminologyExpand(url: string, opts: { count?: string; offset?: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const vs = await ctx.ops.expand(url, { count: opts.count ? Number(opts.count) : undefined, offset: opts.offset ? Number(opts.offset) : undefined });
    out(opts.json, vs, `${vs.expansion?.total ?? 0} total; ${(vs.expansion?.contains ?? []).map((c) => c.code).join(', ')}`); return 0;
  } catch (err) { process.stderr.write(`expand failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyTranslate(url: string, opts: { system: string; code: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { const r = await ctx.ops.translate({ mapUrl: url, system: opts.system, code: opts.code }); out(opts.json, r, r.matches.map((m) => `${m.targetSystem}|${m.targetCode}`).join('\n') || '(no matches)'); return r.result ? 0 : 1; }
  finally { await ctx.close(); }
}

export async function runPublisherList(opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.publishers.list();
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const p of rows) console.log(`${p.id}\t${p.name}\t${p.role}${p.seeded ? '\t(seeded)' : ''}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology publisher list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runPublisherCreate(name: string, opts: { role?: 'local' | 'external'; icon?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const p = await ctx.admin.publishers.create({ name, role: opts.role ?? 'local', icon: opts.icon ?? null });
    out(opts.json ?? false, p, `created publisher ${p.id} (${p.name})`);
    await recordAuditEvent(ctx, cliActor(), { action: 'publisher.create', entityType: 'publisher', entityId: p.id, metadata: { name } });
    return 0;
  } catch (err) { process.stderr.write(`terminology publisher create failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runSystemList(opts: { publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.codingSystems.list(opts.publisher);
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const s of rows) console.log(`${s.systemCode}\t${s.systemName}\t${s.url ?? '—'}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology system list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runSystemCreate(code: string, name: string, opts: { url?: string; version?: string; publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const s = await ctx.admin.codingSystems.create({ systemCode: code, systemName: name, url: opts.url ?? null, systemVersion: opts.version ?? null, active: true, publisherId: opts.publisher ?? null });
    out(opts.json ?? false, s, `created code system ${s.id} (${s.systemCode})`);
    await recordAuditEvent(ctx, cliActor(), { action: 'coding_system.create', entityType: 'coding_system', entityId: s.id, metadata: { systemCode: code } });
    return 0;
  } catch (err) { process.stderr.write(`terminology system create failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTermList(systemUrl: string, opts: { q?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const page = await ctx.admin.terms.search(systemUrl, { query: opts.q, limit: 100, offset: 0 });
    if (opts.json) console.log(JSON.stringify(page, null, 2));
    else for (const t of page.rows) console.log(`${t.code}\t${t.display ?? ''}\t${t.status}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology term list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runValueSetList(opts: { publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.valueSets.list(opts.publisher);
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const v of rows) console.log(`${v.url}\t${v.title ?? v.name ?? 'â€”'}\t${v.status}\t${v.codeCount} codes`);
    return 0;
  } catch (err) { process.stderr.write(`terminology valueset list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

/** DEPRECATED — `openldr db reproject` is the same operation under an honest name.
 *
 *  This command has ALWAYS rebuilt the entire read model, not just terminology_codes: it calls the
 *  general `reprojectAll`. The old description said otherwise, and someone read its count as "8692
 *  terminology rows" when the dimension held 2,025. Kept as a thin alias so existing runbooks and
 *  scripts keep working.
 *
 *  ⚠ It inherits the --force guard. That IS a behaviour change for an unattended script calling the
 *  old name, and it is deliberate: an unguarded command that silently rewrites every projected row
 *  in the warehouse is the hazard, and a loud refusal is better than a silent rebuild. The
 *  deprecation notice names the replacement so the fix is one line. */
export async function runTerminologyReproject(opts: { json: boolean; force: boolean }): Promise<number> {
  process.stderr.write('warning: `terminology reproject` is deprecated — use `openldr db reproject`.\n');
  return runDbReproject(opts);
}

export async function runOntologyBuild(systemId: string, dir: string, opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    await ctx.ontology.build(systemId, dir, (progress) => {
      process.stderr.write(`${progress.phase}: ${progress.processed}${progress.total != null ? `/${progress.total}` : ''}\r`);
    });
    const distribution = await ctx.ontology.getDistribution(systemId);
    out(
      opts.json ?? false,
      distribution,
      `\nbuilt ${distribution?.ontologyType} index: ${distribution?.nodeCount} nodes, ${distribution?.edgeCount} edges`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`\nontology build failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

export async function runOntologyRebuild(systemId: string, opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    await ctx.ontology.rebuild(systemId, (progress) => {
      process.stderr.write(`${progress.phase}: ${progress.processed}${progress.total != null ? `/${progress.total}` : ''}\r`);
    });
    const distribution = await ctx.ontology.getDistribution(systemId);
    out(
      opts.json ?? false,
      distribution,
      `\nrebuilt ${distribution?.ontologyType} index: ${distribution?.nodeCount} nodes, ${distribution?.edgeCount} edges`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`\nontology rebuild failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

export async function runOntologyList(opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.ontology.listDistributions();
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const distribution of rows) {
      console.log(
        `${distribution.codingSystemId}\t${distribution.ontologyType}\t${distribution.indexStatus}\t${distribution.nodeCount ?? '-'} nodes\t${distribution.edgeCount ?? '-'} edges`,
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(`ontology list failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

export async function runOntologyUnlink(systemId: string, opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    await ctx.ontology.unlink(systemId);
    out(opts.json ?? false, { ok: true }, `unlinked ontology index for ${systemId}`);
    await recordAuditEvent(ctx, cliActor(), { action: 'ontology_distribution.delete', entityType: 'ontology_distribution', entityId: systemId, metadata: {} });
    return 0;
  } catch (err) {
    process.stderr.write(`ontology unlink failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

export async function runDistributionImport(system: string, opts: { file?: string; acceptLicense?: boolean; version?: string; json: boolean }): Promise<number> {
  const argErr = validateDistributionImportArgs(system, opts);
  if (argErr) { process.stderr.write(`${argErr}\n`); return 1; }
  const cfg = loadConfig();
  const ctx = await createTerminologyContext(cfg);
  try {
    const codingSystemId = await resolveCodingSystemId(ctx.admin, system, opts.version ?? null);
    const key = `terminology-dist/${system}/${codingSystemId}-${Date.now()}.zip`;
    await ctx.blob.putStream(key, createReadStream(opts.file!), 'application/zip');
    let job;
    try {
      job = await ctx.jobs.insertRunning({ systemType: system, codingSystemId, blobKey: key, version: opts.version ?? null, createdBy: 'cli' });
    } catch (err) {
      // No job row was created, so clean up the just-uploaded blob either way. Only a genuine
      // one-active-per-system conflict is reported as "already in progress"; a transient DB error
      // is surfaced truthfully so the operator isn't told to wait for an import that isn't running.
      await ctx.blob.delete(key).catch(() => {});
      if (isActiveJobConflict(err)) {
        process.stderr.write(`an import for ${system} is already in progress\n`);
      } else {
        process.stderr.write(`terminology distribution import failed: ${redactError(err)}\n`);
      }
      return 1;
    }
    const runIngest = createRunIngest({ blob: ctx.blob, terminology: ctx, workDirBase: cfg.TERMINOLOGY_WORK_DIR ?? tmpdir() });
    const result = await runIngestJob({
      job, jobs: ctx.jobs, blob: ctx.blob, runIngest, audit: ctx.audit, logger: ctx.logger,
      onProgress: (p) => process.stderr.write(`${p.phase}: ${p.processed}${p.total != null ? `/${p.total}` : ''}\r`),
    });
    if (result.status === 'ready') {
      out(opts.json, { system, conceptsLoaded: result.conceptsLoaded }, `\nimported ${system} (${result.conceptsLoaded} concepts)`);
      return 0;
    }
    process.stderr.write(`\nterminology distribution import failed: ${result.error}\n`);
    return 1;
  } catch (err) { process.stderr.write(`terminology distribution import failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDistributionPurge(system: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const job = await ctx.jobs.latestForSystem(system);
    if (job?.blobKey) await ctx.blob.delete(job.blobKey);
    await recordAuditEvent(ctx, cliActor(), { action: 'terminology.distribution.purged', entityType: 'coding_system', entityId: job?.codingSystemId ?? system, metadata: { systemType: system, jobId: job?.id ?? null } });
    out(opts.json, { system, purged: !!job?.blobKey }, job?.blobKey ? `purged ${system} distribution` : `no distribution to purge for ${system}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology distribution purge failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
