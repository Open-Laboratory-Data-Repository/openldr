import { createHash } from 'node:crypto';
import {
  canonicalJSON, evaluateTrust, keyFingerprint, parseContentPack, summarizeContentPack, verifyBundle,
  type Bundle, type ContentPack, type ContentPackStep, type TrustStore,
} from '@openldr/marketplace';
import type { MarketplaceInstallStore, MarketplaceInstallRow } from '@openldr/db';
import type { AuditEventInput } from '@openldr/audit';

interface Audit { record(e: AuditEventInput): Promise<unknown>; }
type Actor = { id: string | null; name: string };
type StepOutcome = { ok: true } | { ok: false; error: string };

export interface ContentPackDeps {
  installStore: MarketplaceInstallStore;
  trustStore: TrustStore;
  audit: Audit;
  loadResource(json: unknown): Promise<{ resourceUrl: string }>;
  /** Throws when the resource would not load. Writes nothing. */
  checkResource(json: unknown): void;
  /** Throws when the query file would not import. Writes nothing. */
  checkQueries(file: unknown): void;
  importQueries(file: unknown): Promise<unknown>;
  register(input: { url: string; name: string; code: string; csv: string; apply: boolean; actor: Actor }): Promise<StepOutcome>;
  linkMatching(registerUrl: string, actor: Actor): Promise<StepOutcome>;
}

export interface ContentPackInstallOptions {
  actor: { id?: string | null; name: string };
  sourceRef?: string;
}

export interface ContentPackInstallResult {
  id: string;
  version: string;
  status: 'installed' | 'failed';
  failedStep?: number;
  error?: string;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createContentPackInstaller(deps: ContentPackDeps) {
  const { installStore, trustStore, audit } = deps;

  /**
   * Pass 1. Everything that can be checked without writing. Throws on the first problem.
   * Returns the parsed pack and its step summary.
   */
  async function verify(bundle: Bundle, actor: Actor) {
    if (bundle.manifest.type !== 'content-pack' || bundle.manifest.payload.kind !== 'content-pack') {
      throw new Error(`not a content-pack: ${bundle.manifest.type}`);
    }
    if ((bundle.manifest.capabilities ?? []).length > 0) throw new Error('a content pack declares no capabilities');

    const publisher = bundle.manifest.publisher;
    if (publisher) {
      if (!verifyBundle(bundle).valid) throw new Error('bundle failed verification');
      // The signature only covers bundle.raw. Reject a parsed manifest that diverges from it.
      if (bundle.manifest.id !== bundle.raw.id || bundle.manifest.version !== bundle.raw.version) {
        throw new Error('manifest does not match signed payload');
      }
      const decision = evaluateTrust(publisher.id, keyFingerprint(bundle.publicKeyDer), await trustStore.get(publisher.id));
      if (decision.decision === 'key-mismatch') throw new Error('publisher key does not match the pinned key');
    }

    const payload = bundle.manifest.payload;
    if (createHash('sha256').update(bundle.wasm).digest('hex') !== payload.packSha256) {
      throw new Error('pack.json does not match the signed hash');
    }
    const pack: ContentPack = parseContentPack(JSON.parse(new TextDecoder().decode(bundle.wasm)));
    const steps = summarizeContentPack(pack);
    if (canonicalJSON(payload.steps) !== canonicalJSON(steps)) throw new Error('step list does not match pack.json');

    for (const step of pack.steps) {
      switch (step.kind) {
        case 'code-system':
        case 'value-set':
          deps.checkResource(step.resource);
          break;
        case 'custom-queries':
          deps.checkQueries(step.file);
          break;
        case 'facility-register': {
          const out = await deps.register({ url: step.url, name: step.name, code: step.code, csv: step.csv, apply: false, actor });
          if (!out.ok) throw new Error(out.error);
          break;
        }
        case 'link-matching':
          break;
      }
    }
    return { pack, steps };
  }

  async function runStep(step: ContentPackStep, actor: Actor): Promise<void> {
    switch (step.kind) {
      case 'code-system':
      case 'value-set':
        await deps.loadResource(step.resource);
        return;
      case 'facility-register': {
        const out = await deps.register({ url: step.url, name: step.name, code: step.code, csv: step.csv, apply: true, actor });
        if (!out.ok) throw new Error(out.error);
        return;
      }
      case 'link-matching': {
        const out = await deps.linkMatching(step.registerUrl, actor);
        if (!out.ok) throw new Error(out.error);
        return;
      }
      case 'custom-queries':
        await deps.importQueries(step.file);
        return;
    }
  }

  async function check(bundle: Bundle): Promise<{ steps: { kind: string; label: string; count: number }[] }> {
    const { steps } = await verify(bundle, { id: null, name: 'check' });
    return { steps };
  }

  async function install(bundle: Bundle, opts: ContentPackInstallOptions): Promise<ContentPackInstallResult> {
    const actor: Actor = { id: opts.actor.id ?? null, name: opts.actor.name };
    const { pack } = await verify(bundle, actor);

    const artifactId = bundle.manifest.id;
    const version = bundle.manifest.version;
    const publisher = bundle.manifest.publisher;
    if (publisher) {
      // Pin on first use. A repeat install of the same key is a harmless rewrite.
      await trustStore.pin({
        publisherId: publisher.id, keyFingerprint: keyFingerprint(bundle.publicKeyDer),
        publisherName: publisher.name, approvedBy: actor.id ?? actor.name,
      });
    }

    let failedStep: number | undefined;
    let error: string | undefined;
    for (let i = 0; i < pack.steps.length; i++) {
      try {
        await runStep(pack.steps[i], actor);
      } catch (err) {
        failedStep = i + 1;
        error = messageOf(err);
        break;
      }
    }

    const status: 'installed' | 'failed' = failedStep === undefined ? 'installed' : 'failed';
    await installStore.upsert({
      artifactId, version, kind: 'content-pack', targetFormId: null,
      payloadSha256: payloadHash(bundle),
      publisherName: publisher?.name ?? null, sourceRef: opts.sourceRef ?? null,
      installedBy: actor.id ?? actor.name,
      status, failedStep: failedStep ?? null, error: error ?? null,
    });
    await audit.record({
      actorType: 'user', actorId: actor.id, actorName: actor.name,
      action: 'marketplace.install', entityType: 'marketplace.artifact', entityId: `${artifactId}@${version}`,
      metadata: { type: 'content-pack', status, steps: pack.steps.length, ...(failedStep !== undefined ? { failedStep, error } : {}) },
    });

    return status === 'installed'
      ? { id: artifactId, version, status }
      : { id: artifactId, version, status, failedStep, error };
  }

  async function detach(artifactId: string, opts: { actor: { id?: string | null; name: string } }): Promise<void> {
    const row = await installStore.get(artifactId);
    if (!row || row.kind !== 'content-pack') throw new Error('not installed');
    await installStore.remove(artifactId);
    await audit.record({
      actorType: 'user', actorId: opts.actor.id ?? null, actorName: opts.actor.name,
      action: 'marketplace.detach', entityType: 'marketplace.artifact', entityId: artifactId,
      metadata: { type: 'content-pack' },
    });
  }

  async function list(): Promise<MarketplaceInstallRow[]> {
    return (await installStore.list()).filter((r) => r.kind === 'content-pack');
  }

  return { check, install, detach, list };
}

/** The signed hash of pack.json. Pass 1 already proved it equals the bytes. */
function payloadHash(bundle: Bundle): string {
  return (bundle.manifest.payload as { packSha256: string }).packSha256;
}

export type ContentPackInstaller = ReturnType<typeof createContentPackInstaller>;
