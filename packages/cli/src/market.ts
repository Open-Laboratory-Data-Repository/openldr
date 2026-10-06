import { createAppContext, createIngestContext, type AppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { readBundle, verifyBundle, type Bundle } from '@openldr/marketplace';
import { redactError } from './redact-error';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

const cliActor = { name: 'cli' } as const;

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export async function runMarketVerify(dir: string, opts: JsonOpt): Promise<number> {
  try {
    const bundle = await readBundle(dir);
    const result = verifyBundle(bundle);
    const { manifest } = bundle;
    const payload = {
      id: manifest.id,
      version: manifest.version,
      publisher: manifest.publisher,
      capabilities: manifest.capabilities,
      compatibility: manifest.compatibility,
      fingerprint: result.fingerprint,
      valid: result.valid,
    };
    emit(
      opts.json,
      payload,
      `${manifest.id}@${manifest.version}  valid=${result.valid}  publisher=${manifest.publisher?.id ?? '(none)'}`,
    );
    return result.valid ? 0 : 1;
  } catch (err) {
    process.stderr.write(`market verify failed: ${redactError(err)}\n`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// install / update  (identical logic — update is just re-install)
// ---------------------------------------------------------------------------

export async function runMarketInstall(
  dir: string,
  opts: JsonOpt & { approve?: boolean; approvedBy?: string; dryRun?: boolean; force?: boolean },
): Promise<number> {
  let bundle: Bundle;
  try {
    bundle = await readBundle(dir);
  } catch (err) {
    process.stderr.write(`market install failed: ${redactError(err)}\n`);
    return 1;
  }
  const approval =
    opts.approve
      ? {
          approvedBy: opts.approvedBy ?? 'cli',
          acknowledgedCapabilities: bundle.manifest.capabilities,
        }
      : undefined;

  if (bundle.manifest.type === 'content-pack') return installPack(bundle, opts);
  if (bundle.manifest.type === 'form-template') return installForm(bundle, approval, opts);

  const ctx = await createIngestContext(loadConfig());
  try {
    if (opts.dryRun) {
      const { id, version } = bundle.manifest;
      emit(opts.json, { id, version, dryRun: true }, `dry run: would install ${id}@${version}`);
      return 0;
    }
    const installed = await ctx.plugins.install(bundle.wasm, bundle.raw, {
      publicKeyDer: bundle.publicKeyDer,
      actor: cliActor,
      ui: bundle.ui,
      approval,
    });
    emit(
      opts.json,
      { id: installed.id, version: installed.version },
      `installed ${installed.id}@${installed.version}`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`market install failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

async function installForm(
  bundle: Bundle,
  approval: Parameters<AppContext['marketplaceForms']['install']>[1]['approval'],
  opts: JsonOpt & { dryRun?: boolean },
): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const { id, version } = bundle.manifest;
    if (opts.dryRun) {
      emit(opts.json, { id, version, dryRun: true }, `dry run: would install ${id}@${version}`);
      return 0;
    }
    const installed = await ctx.marketplaceForms.install(bundle, {
      actor: cliActor,
      approval,
    });
    emit(opts.json, { id: installed.id, version: installed.version }, `installed ${installed.id}@${installed.version}`);
    return 0;
  } catch (err) {
    process.stderr.write(`market install failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

async function installPack(
  bundle: Bundle,
  opts: JsonOpt & { dryRun?: boolean; force?: boolean },
): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const { id, version } = bundle.manifest;
    if (opts.dryRun) {
      const { steps } = await ctx.marketplacePacks.check(bundle);
      emit(
        opts.json,
        { id, version, dryRun: true, steps },
        [
          `dry run: ${id}@${version} would run ${steps.length} step(s)`,
          ...steps.map((s, i) => `  ${i + 1}. ${s.kind.padEnd(18)} ${s.label} (${s.count})`),
        ].join('\n'),
      );
      return 0;
    }
    const existing = (await ctx.marketplacePacks.list()).find((r) => r.artifactId === id);
    if (existing && !opts.force) {
      process.stderr.write(`market install failed: ${id} is already installed; use --force to install again\n`);
      return 1;
    }
    const result = await ctx.marketplacePacks.install(bundle, { actor: { id: null, name: 'cli' } });
    if (result.status === 'failed') {
      if (opts.json) emit(true, result, '');
      else process.stderr.write(`failed at step ${result.failedStep}: ${result.error}\n`);
      return 1;
    }
    emit(opts.json, result, `installed ${result.id}@${result.version}`);
    return 0;
  } catch (err) {
    process.stderr.write(`market install failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function runMarketList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.plugins.list();
    const packs = await ctx.marketplacePacks.list();
    const lines = [
      ...rows.map(
        (r) =>
          `  ${r.id.padEnd(22)} ${r.version.padEnd(10)} ${r.status.padEnd(12)} enabled=${r.enabled} active=${r.active}`,
      ),
      ...packs.map(
        (p) =>
          `  ${p.artifactId.padEnd(22)} ${p.version.padEnd(10)} ${p.status.padEnd(12)} content-pack` +
          (p.status === 'failed' ? ` failed at step ${p.failedStep}: ${p.error}` : ''),
      ),
    ];
    emit(
      opts.json,
      [
        ...rows.map((r) => ({
          id: r.id,
          version: r.version,
          status: r.status,
          sha256: r.sha256,
          enabled: r.enabled,
          active: r.active,
          approvedBy: r.approvedBy,
        })),
        ...packs.map((p) => ({
          type: 'content-pack',
          id: p.artifactId,
          version: p.version,
          status: p.status,
          failedStep: p.failedStep,
          error: p.error,
        })),
      ],
      lines.join('\n') || '  (nothing installed)',
    );
    return 0;
  } catch (err) {
    process.stderr.write(`market list failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

export async function runMarketRollback(
  id: string,
  version: string,
  opts: JsonOpt,
): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    await ctx.plugins.rollback(id, version, { actor: cliActor });
    emit(opts.json, { id, version, rolledBack: true }, `rolled back ${id} to ${version}`);
    return 0;
  } catch (err) {
    process.stderr.write(`market rollback failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// enable / disable
// ---------------------------------------------------------------------------

export async function runMarketEnable(id: string, opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    await ctx.plugins.setEnabled(id, true, { actor: cliActor });
    emit(opts.json, { id, enabled: true }, `enabled ${id}`);
    return 0;
  } catch (err) {
    process.stderr.write(`market enable failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

export async function runMarketDisable(id: string, opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    await ctx.plugins.setEnabled(id, false, { actor: cliActor });
    emit(opts.json, { id, enabled: false }, `disabled ${id}`);
    return 0;
  } catch (err) {
    process.stderr.write(`market disable failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

export async function runMarketRemove(
  id: string,
  version: string | undefined,
  opts: JsonOpt,
): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    await ctx.plugins.remove(id, version, { actor: cliActor });
    emit(
      opts.json,
      { removed: id, version: version ?? 'all' },
      `removed ${id}${version ? '@' + version : ' (all versions)'}`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`market remove failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
