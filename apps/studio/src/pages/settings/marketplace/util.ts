import type { AvailableArtifact, ArtifactPayloadMeta, InstalledArtifact } from '@/api';
import { compareVersions } from '@/docs/version';

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
  /** Browse only: the active version when the plugin is installed but this card's version is not. */
  activeVersion?: string;
  enabled?: boolean;     // installed AND user-enabled (on/off toggle)
  drifted?: boolean;     // installed form-template modified locally
  targetFormId?: string; // installed form-template's local form id
  versions?: { version: string; ref: string }[];
  registryName?: string; // Browse only: source registry label
  /** Browse only: the CE range this CE does not meet. Set only when the list knows the bundle cannot run here. */
  needsCe?: string;
  status?: 'installed' | 'failed'; // content-pack only
  failedStep?: number | null;
  error?: string | null;
  /** Installed only: a newer Marketplace version than the active one, if any. */
  update?: NewerVersion | null;
  /** Installed only: every installed version of this id, each with its publisher's name (null when unknown). */
  installedVersions?: { version: string; active: boolean; publisher: string | null }[];
}

export interface NewerVersion { version: string; ref: string; rolledBack: boolean }

/** The newest Marketplace version of `id` that is newer than the active one, or null.
 *  `rolledBack` is true when a newer version is installed but an older one is active: the person
 *  went back on purpose, so the page offers the update quietly. */
export function newerAvailable(id: string, activeVersion: string, available: AvailableArtifact[], installedVersions: string[]): NewerVersion | null {
  let best: AvailableArtifact | null = null;
  for (const b of available) {
    if (b.id !== id || compareVersions(b.version, activeVersion) <= 0) continue;
    // A version this CE cannot run is no update. Install would refuse it after the consent sheet.
    if (b.compatible === false) continue;
    if (!best || compareVersions(b.version, best.version) > 0) best = b;
  }
  if (!best) return null;
  const rolledBack = installedVersions.some((v) => compareVersions(v, activeVersion) > 0);
  return { version: best.version, ref: best.ref, rolledBack };
}

// i18n key per capability kind. i18next reads ':' as a namespace separator, so the kinds are not
// used as keys directly.
const CAPABILITY_KEY: Record<string, string> = {
  'read-input': 'readInput', 'emit-fhir': 'emitFhir', 'net-egress': 'netEgress', 'data-scope': 'dataScope',
  'host:reports': 'hostReports', 'host:connectors': 'hostConnectors', 'host:schedule': 'hostSchedule',
  'host:fhir': 'hostFhir', 'host:import': 'hostImport', 'host:db': 'hostDb', 'host:ce-read': 'hostCeRead',
};

/** One capability as a plain sentence for the Permissions list and the install consent, with its
 *  code after it so an administrator can still match it to the manifest. An unknown kind shows its
 *  code alone. */
export function capabilityLine(cap: unknown, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (typeof cap !== 'object' || cap === null) return String(cap);
  const c = cap as Record<string, unknown>;
  if (typeof c.kind !== 'string') return JSON.stringify(cap);
  const key = CAPABILITY_KEY[c.kind];
  if (!key) return c.kind;
  const items = (Array.isArray(c.resourceTypes) ? c.resourceTypes : Array.isArray(c.allowedHosts) ? c.allowedHosts : Array.isArray(c.formats) ? c.formats : []) as string[];
  const list = items.length ? items.join(', ') : t('settings.marketplace.capability.none');
  return `${t(`settings.marketplace.capability.${key}`, { list, interpolation: { escapeValue: false } })} (${c.kind})`;
}

export function availableToEntry(b: AvailableArtifact, installed: Map<string, InstalledArtifact>, rows: readonly InstalledArtifact[] = []): CardEntry {
  // Merge the installed state so a Browse entry that is already installed carries the
  // real enabled/active flags — otherwise the detail menu shows the wrong Enable/Disable
  // label (and rollback visibility) for installed plugins viewed from Browse.
  // ⛔ Active is this card's OWN version. Two registries can offer the same id (the public build
  // and a local test build), and matching by id alone marked both cards Active, one for a version
  // that was not even installed. `installed` stays per id: Enable, Disable and Update act on the plugin.
  const inst = installed.get(b.id);
  const same = (a: InstalledArtifact) => a.id === b.id && a.type === b.type && a.version === b.version;
  const own = rows.find(same) ?? (inst && same(inst) ? inst : undefined);
  return {
    ref: b.ref, id: b.id, version: b.version, type: b.type,
    publisher: b.publisher, description: b.description, license: b.license,
    capabilities: b.capabilities ?? [], valid: b.valid, invalidReason: b.invalidReason,
    installed: Boolean(inst), enabled: inst?.enabled, active: own ? own.active : false,
    ...(inst && !own ? { activeVersion: inst.version } : {}),
    status: inst?.status, failedStep: inst?.failedStep, error: inst?.error,
    versions: b.versions ?? [], registryName: b.registryName,
    ...(b.compatible === false && b.compatibility ? { needsCe: b.compatibility.ceVersion } : {}),
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

interface DeclaredPermission {
  key: string; label: string; description: string;
  labels?: Partial<Record<'fr' | 'pt', { label: string; description: string }>>;
}

/** Lines for the install consent. First one line per permission a plugin declares: its label and
 *  description in the page language (English when the plugin gave none), its key, and the actions
 *  that need it. Then one line per action whose list has any CE capability, naming those
 *  capabilities by the role editor's translated label (or by the key when there is none). When the
 *  list also has one of the plugin's own keys, the line says holders of the CE capability can run it too.
 *  Reads `payload.permissions` and `payload.actionPermissions` from the signed manifest. A payload
 *  without them gives no lines. */
export function pluginPermissionLines(
  payload: ArtifactPayloadMeta | null | undefined, lang: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string[] {
  const perms = Array.isArray(payload?.permissions) ? (payload.permissions as DeclaredPermission[]) : [];
  const actions = (payload?.actionPermissions && typeof payload.actionPermissions === 'object'
    ? payload.actionPermissions : {}) as Record<string, unknown>;
  const code = lang.slice(0, 2);
  const declared = new Set(perms.map((p) => p.key));
  const own = perms.map((p) => {
    const local = code === 'fr' || code === 'pt' ? p.labels?.[code] : undefined;
    const label = local?.label ?? p.label;
    const description = local?.description ?? p.description;
    const needing = Object.keys(actions).filter((a) => Array.isArray(actions[a]) && (actions[a] as unknown[]).includes(p.key));
    const opts = { label, description, key: p.key, actions: needing.join(', '), interpolation: { escapeValue: false } };
    return needing.length
      ? t('settings.marketplace.pluginPermissionUsed', opts)
      : t('settings.marketplace.pluginPermissionUnused', opts);
  });
  const ceLines: string[] = [];
  for (const [action, list] of Object.entries(actions)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const keys = list.filter((k): k is string => typeof k === 'string');
    const ce = keys.filter((k) => !declared.has(k));
    if (ce.length === 0) continue;
    const names = ce.map((k) => t(`roles.capability.${k}.label`, { defaultValue: k }));
    // An action that also lists one of the plugin's own keys: holders of the CE capability can run it too.
    const msg = ce.length === keys.length ? 'pluginActionNeeds' : 'pluginActionAlsoRunBy';
    ceLines.push(t(`settings.marketplace.${msg}`, {
      action, list: names.join(t('settings.marketplace.pluginActionOr')), interpolation: { escapeValue: false },
    }));
  }
  return [...own, ...ceLines];
}
