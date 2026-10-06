import type { AvailableArtifact, ArtifactPayloadMeta, InstalledArtifact } from '@/api';

/** A minimal, source-agnostic shape for a card + detail header. */
export interface CardEntry {
  ref?: string;          // present only for Browse (registry) items
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  description?: string | null;   // from the bundle/manifest (used when no registry detail)
  license?: string | null;
  payload?: ArtifactPayloadMeta | null;
  capabilities: unknown[];
  valid?: boolean;       // Browse only (signature validity)
  invalidReason?: AvailableArtifact['invalidReason']; // Browse only: which check failed when valid === false
  installed?: boolean;   // is this id currently installed?
  active?: boolean;      // installed AND active version
  enabled?: boolean;     // installed AND user-enabled (on/off toggle)
  drifted?: boolean;     // installed form-template modified locally
  targetFormId?: string; // installed form-template's local form id
  versions?: { version: string; ref: string }[];
  registryName?: string; // Browse only: source registry label
  status?: 'installed' | 'failed'; // content-pack only
  failedStep?: number | null;
  error?: string | null;
}

/** Render one capability as a human-readable line for the Permissions list. */
export function capabilityLine(cap: unknown): string {
  if (typeof cap !== 'object' || cap === null) return String(cap);
  const c = cap as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof c.kind === 'string') parts.push(c.kind);
  if (Array.isArray(c.resourceTypes)) parts.push(`(${(c.resourceTypes as string[]).join(', ')})`);
  if (Array.isArray(c.allowedHosts)) parts.push(`(${(c.allowedHosts as string[]).join(', ') || 'none'})`);
  return parts.join(' ') || JSON.stringify(cap);
}

export function availableToEntry(b: AvailableArtifact, installed: Map<string, InstalledArtifact>): CardEntry {
  // Merge the installed state so a Browse entry that is already installed carries the
  // real enabled/active flags — otherwise the detail menu shows the wrong Enable/Disable
  // label (and rollback visibility) for installed plugins viewed from Browse.
  const inst = installed.get(b.id);
  return {
    ref: b.ref, id: b.id, version: b.version, type: b.type,
    publisher: b.publisher, description: b.description, license: b.license,
    capabilities: b.capabilities ?? [], valid: b.valid, invalidReason: b.invalidReason,
    installed: Boolean(inst), enabled: inst?.enabled, active: inst?.active,
    status: inst?.status, failedStep: inst?.failedStep, error: inst?.error,
    versions: b.versions ?? [], registryName: b.registryName,
  };
}

/** An installed row has no registry-qualified ref. For a content pack, borrow the ref of the Browse
 *  entry with the same id so "Install again" has something to install. No match means no ref. */
export function withBrowseRef(entry: CardEntry, available: AvailableArtifact[]): CardEntry {
  if (entry.type !== 'content-pack' || entry.ref) return entry;
  const match = available.find((b) => b.id === entry.id && b.type === 'content-pack');
  return match ? { ...entry, ref: match.ref } : entry;
}

export function installedToEntry(a: InstalledArtifact): CardEntry {
  const pub = a.publisher && typeof a.publisher === 'object'
    ? (a.publisher as { id?: string; name?: string })
    : null;
  return {
    id: a.id, version: a.version, type: a.type,
    publisher: pub ? { id: pub.id ?? '', name: pub.name ?? '' } : null,
    description: a.description, license: a.license, payload: a.payload,
    capabilities: a.capabilities, installed: true, active: a.active,
    enabled: a.enabled, drifted: a.drifted, targetFormId: a.targetFormId,
    status: a.status, failedStep: a.failedStep, error: a.error,
  };
}

/** "Failed at step N: error", or "Failed: error" when the server sent no step. */
export function packFailureText(
  t: (key: string, opts?: Record<string, unknown>) => string,
  step: number | null | undefined, error: string | null | undefined,
): string {
  const e = error ?? '';
  return typeof step === 'number'
    ? t('settings.marketplace.packFailedAt', { step, error: e })
    : t('settings.marketplace.packFailed', { error: e });
}
