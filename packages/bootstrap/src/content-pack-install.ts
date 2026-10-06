import { createHash } from 'node:crypto';
import {
  canonicalJSON, evaluateTrust, keyFingerprint, parseContentPack, summarizeContentPack, verifyBundle,
  type Bundle, type ContentPack, type ContentPackStep, type TrustStore,
} from '@openldr/marketplace';
import type { MarketplaceInstallStore, MarketplaceInstallRow } from '@openldr/db';
import { safeRecord, type AuditEventInput, type AuditStore } from '@openldr/audit';
import { redact, type Logger } from '@openldr/core';

type Actor = { id: string | null; name: string };
type StepOutcome = { ok: true } | { ok: false; error: string };

/** One custom query a pack created or replaced, with its row before and after. */
export interface PackQueryChange {
  id: string;
  outcome: 'created' | 'replaced';
  before: unknown;
  after: unknown;
}

/** What link-matching would do for one register. `wouldLink` is null when the register is not loaded yet. */
export interface LinkPreview { registerUrl: string; wouldLink: number | null }

export interface ContentPackDeps {
  installStore: MarketplaceInstallStore;
  trustStore: TrustStore;
  audit: Pick<AuditStore, 'record'>;
  logger: Logger;
  /** Loads a terminology resource as installed by the pack `packId` (its source shows as that pack). */
  loadResource(json: unknown, packId: string): Promise<{ resourceUrl: string }>;
  /** Throws when the resource would not load. Writes nothing. */
  checkResource(json: unknown): void;
  /** Throws when the query file would not import. Writes nothing. */
  checkQueries(file: unknown): void;
  /** Imports with replace. Returns each created or replaced query with its row before and after. */
  importQueries(file: unknown): Promise<{ changes: PackQueryChange[] }>;
  register(input: { url: string; name: string; code: string; csv: string; apply: boolean; actor: Actor }): Promise<StepOutcome>;
  linkMatching(registerUrl: string, actor: Actor): Promise<{ ok: true; counts: Record<string, number> } | { ok: false; error: string }>;
  /** Link-matching with `apply: false`. Writes nothing. */
  previewLinkMatching(registerUrl: string): Promise<
    | { ok: true; wouldLink: number }
    | { ok: false; reason: 'unknown-register' | 'deactivated-register'; error: string }
  >;
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
  const { installStore, trustStore } = deps;

  /** Best effort. A failed audit write is logged and never fails a step that already wrote. */
  const record = (e: AuditEventInput): Promise<void> => safeRecord(deps.audit as AuditStore, deps.logger, e);
  const who = (actor: Actor) => ({ actorType: 'user' as const, actorId: actor.id, actorName: actor.name });

  /**
   * Pass 1. Everything that can be checked without writing. Throws on the first problem.
   * Returns the parsed pack, its step summary and what link-matching would link.
   */
  async function verify(bundle: Bundle, actor: Actor) {
    if (bundle.manifest.type !== 'content-pack' || bundle.manifest.payload.kind !== 'content-pack') {
      throw new Error(`not a content-pack: ${bundle.manifest.type}`);
    }
    if ((bundle.manifest.capabilities ?? []).length > 0) throw new Error('a content pack declares no capabilities');

    const publisher = bundle.manifest.publisher;
    if (!publisher) throw new Error('a content pack must be signed by a publisher');
    if (!verifyBundle(bundle).valid) throw new Error('bundle failed verification');
    // The signature only covers bundle.raw. Reject a parsed manifest that diverges from it.
    if (bundle.manifest.id !== bundle.raw.id || bundle.manifest.version !== bundle.raw.version) {
      throw new Error('manifest does not match signed payload');
    }
    const decision = evaluateTrust(publisher.id, keyFingerprint(bundle.publicKeyDer), await trustStore.get(publisher.id));
    if (decision.decision === 'key-mismatch') throw new Error('publisher key does not match the pinned key');

    const payload = bundle.manifest.payload;
    if (createHash('sha256').update(bundle.wasm).digest('hex') !== payload.packSha256) {
      throw new Error('pack.json does not match the signed hash');
    }
    const pack: ContentPack = parseContentPack(JSON.parse(new TextDecoder().decode(bundle.wasm)));
    const steps = summarizeContentPack(pack);
    if (canonicalJSON(payload.steps) !== canonicalJSON(steps)) throw new Error('step list does not match pack.json');

    const linkPreview: LinkPreview[] = [];
    const packRegisters = new Set<string>();
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
          packRegisters.add(step.url);
          break;
        }
        case 'link-matching': {
          const out = await deps.previewLinkMatching(step.registerUrl);
          if (out.ok) {
            linkPreview.push({ registerUrl: step.registerUrl, wouldLink: out.wouldLink });
          } else if (out.reason === 'unknown-register' && packRegisters.has(step.registerUrl)) {
            // An earlier step of this pack creates the register. Its rows cannot be counted before they load.
            linkPreview.push({ registerUrl: step.registerUrl, wouldLink: null });
          } else {
            throw new Error(out.error);
          }
          break;
        }
      }
    }
    return { pack, steps, linkPreview };
  }

  async function runStep(step: ContentPackStep, actor: Actor, at: { pack: string; step: number }): Promise<void> {
    const source = { source: 'content-pack', pack: at.pack, step: at.step };
    switch (step.kind) {
      case 'code-system':
      case 'value-set': {
        const result = await deps.loadResource(step.resource, at.pack);
        await record({
          ...who(actor), action: 'term.import', entityType: 'term', entityId: result.resourceUrl,
          metadata: { ...source, result },
        });
        return;
      }
      case 'facility-register': {
        // The register helper writes its own `facility.import` audit.
        const out = await deps.register({ url: step.url, name: step.name, code: step.code, csv: step.csv, apply: true, actor });
        if (!out.ok) throw new Error(out.error);
        return;
      }
      case 'link-matching': {
        const out = await deps.linkMatching(step.registerUrl, actor);
        if (!out.ok) throw new Error(out.error);
        await record({
          ...who(actor), action: 'facility.link-matching', entityType: 'facility',
          entityId: `facility-register:${step.registerUrl}`, before: null, after: null,
          metadata: { ...source, registerUrl: step.registerUrl, counts: out.counts },
        });
        return;
      }
      case 'custom-queries': {
        const { changes } = await deps.importQueries(step.file);
        for (const c of changes) {
          // A pack replaces a query by name, so the before row keeps the SQL it overwrote.
          await record({
            ...who(actor), action: c.outcome === 'created' ? 'customQuery.create' : 'customQuery.update',
            entityType: 'customQuery', entityId: c.id,
            before: c.outcome === 'created' ? null : c.before, after: c.after, metadata: source,
          });
        }
        return;
      }
    }
  }

  async function check(bundle: Bundle): Promise<{ steps: { kind: string; label: string; count: number }[]; linkPreview: LinkPreview[] }> {
    const { steps, linkPreview } = await verify(bundle, { id: null, name: 'check' });
    return { steps, linkPreview };
  }

  async function install(bundle: Bundle, opts: ContentPackInstallOptions): Promise<ContentPackInstallResult> {
    const actor: Actor = { id: opts.actor.id ?? null, name: opts.actor.name };
    const { pack } = await verify(bundle, actor);

    const artifactId = bundle.manifest.id;
    const version = bundle.manifest.version;
    // Pass 1 refused a bundle with no publisher.
    const publisher = bundle.manifest.publisher!;
    // Pin on first use. A repeat install of the same key is a harmless rewrite.
    await trustStore.pin({
      publisherId: publisher.id, keyFingerprint: keyFingerprint(bundle.publicKeyDer),
      publisherName: publisher.name, approvedBy: actor.id ?? actor.name,
    });

    let failedStep: number | undefined;
    let error: string | undefined;
    for (let i = 0; i < pack.steps.length; i++) {
      try {
        await runStep(pack.steps[i], actor, { pack: `${artifactId}@${version}`, step: i + 1 });
      } catch (err) {
        failedStep = i + 1;
        // The text reaches the install row, the audit and the UI. Mask secrets a driver error may echo.
        error = redact(messageOf(err));
        break;
      }
    }

    const status: 'installed' | 'failed' = failedStep === undefined ? 'installed' : 'failed';
    await installStore.upsert({
      artifactId, version, kind: 'content-pack', targetFormId: null,
      payloadSha256: payloadHash(bundle),
      publisherName: publisher.name, sourceRef: opts.sourceRef ?? null,
      installedBy: actor.id ?? actor.name,
      status, failedStep: failedStep ?? null, error: error ?? null,
    });
    await record({
      ...who(actor),
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
    await record({
      ...who({ id: opts.actor.id ?? null, name: opts.actor.name }),
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
