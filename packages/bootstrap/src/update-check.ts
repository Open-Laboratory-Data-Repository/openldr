import type { AppSettingStore } from '@openldr/db';
import { isNewerVersion, parseReleaseManifest } from '@openldr/core/pure';

/** Discrete keys, deliberately not one JSON blob. A blob written by one surface and never read
 *  by another is a failure mode this repo has already shipped once — see the sync config
 *  migration in sync-settings-migrate.ts. */
export const UPDATE_KEYS = {
  enabled: 'update.enabled',
  latestVersion: 'update.latestVersion',
  releasedAt: 'update.releasedAt',
  notesUrl: 'update.notesUrl',
  firstSeenAt: 'update.firstSeenAt',
  lastCheckedAt: 'update.lastCheckedAt',
  lastError: 'update.lastError',
} as const;

export interface UpdateState {
  enabled: boolean;
  running: string;
  latestVersion: string | null;
  releasedAt: string | null;
  notesUrl: string | null;
  firstSeenAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  updateAvailable: boolean;
}

export interface UpdateCheck {
  read(running: string): Promise<UpdateState>;
  setEnabled(on: boolean, actor: string | null): Promise<void>;
  record(manifest: { version: string; releasedAt: string; notesUrl: string }, now: string): Promise<void>;
  recordFailure(message: string, now: string): Promise<void>;
}

/** Pure. Given what is running, what is cached and whether the check is on, is there an update?
 *
 *  `isNewerVersion` returns false when either side is unparseable, so a malformed manifest or a
 *  dev build degrades to "no update known" rather than a false alarm. */
export function decideUpdate(input: {
  enabled: boolean;
  running: string;
  cached: { version: string | null; releasedAt: string | null; notesUrl: string | null; firstSeenAt: string | null };
  lastCheckedAt: string | null;
  lastError: string | null;
}): UpdateState {
  const { enabled, running, cached } = input;
  // The switch suppresses the ANSWER, not just the polling: an operator who turned it off must
  // not keep seeing a banner produced from a cache written before they did.
  const updateAvailable = enabled && cached.version !== null && isNewerVersion(cached.version, running);
  return {
    enabled,
    running,
    latestVersion: cached.version,
    releasedAt: cached.releasedAt,
    notesUrl: cached.notesUrl,
    firstSeenAt: cached.firstSeenAt,
    lastCheckedAt: input.lastCheckedAt,
    lastError: input.lastError,
    updateAvailable,
  };
}

export function createUpdateCheck(store: AppSettingStore): UpdateCheck {
  const read1 = async (key: string): Promise<string | null> => {
    const row = await store.get(key);
    const v = row?.value ?? '';
    return v === '' ? null : v;
  };

  return {
    async read(running) {
      const [enabledRaw, version, releasedAt, notesUrl, firstSeenAt, lastCheckedAt, lastError] = await Promise.all([
        read1(UPDATE_KEYS.enabled),
        read1(UPDATE_KEYS.latestVersion),
        read1(UPDATE_KEYS.releasedAt),
        read1(UPDATE_KEYS.notesUrl),
        read1(UPDATE_KEYS.firstSeenAt),
        read1(UPDATE_KEYS.lastCheckedAt),
        read1(UPDATE_KEYS.lastError),
      ]);
      // Default ON: only the exact string 'false' turns it off, so an absent or corrupt value
      // fails toward the operator being told.
      const enabled = enabledRaw !== 'false';
      return decideUpdate({
        enabled,
        running,
        cached: { version, releasedAt, notesUrl, firstSeenAt },
        lastCheckedAt,
        lastError,
      });
    },

    async setEnabled(on, actor) {
      await store.set(UPDATE_KEYS.enabled, on ? 'true' : 'false', actor);
    },

    async record(manifest, now) {
      const previous = await read1(UPDATE_KEYS.latestVersion);
      // ⛔ firstSeenAt moves ONLY when the version changes. It is the notification's createdAt,
      // and a value that moves on every poll makes the bell entry undismissable.
      if (previous !== manifest.version) {
        await store.set(UPDATE_KEYS.firstSeenAt, now, 'update-check');
      }
      await store.set(UPDATE_KEYS.latestVersion, manifest.version, 'update-check');
      await store.set(UPDATE_KEYS.releasedAt, manifest.releasedAt, 'update-check');
      await store.set(UPDATE_KEYS.notesUrl, manifest.notesUrl, 'update-check');
      await store.set(UPDATE_KEYS.lastCheckedAt, now, 'update-check');
      await store.set(UPDATE_KEYS.lastError, '', 'update-check');
    },

    async recordFailure(message, now) {
      // Deliberately does NOT touch latestVersion. An air-gapped lab keeps what it last knew.
      await store.set(UPDATE_KEYS.lastCheckedAt, now, 'update-check');
      await store.set(UPDATE_KEYS.lastError, message, 'update-check');
    },
  };
}

export const LATEST_JSON_URL =
  'https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PollDeps {
  check: UpdateCheck;
  fetchText: (url: string) => Promise<string>;
  now: () => string;
  url?: string;
}

/** One poll. NEVER throws: a background check that can crash its caller is worse than one that
 *  silently misses a release. */
export async function pollOnce(deps: PollDeps): Promise<void> {
  const { check, fetchText, now } = deps;
  try {
    // "Off" means no traffic leaves the lab, not merely a hidden answer.
    const state = await check.read('0.0.0');
    if (!state.enabled) return;

    const text = await fetchText(deps.url ?? LATEST_JSON_URL);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await check.recordFailure('response was not JSON', now());
      return;
    }
    const manifest = parseReleaseManifest(raw);
    if (!manifest) {
      await check.recordFailure('manifest did not match the expected shape', now());
      return;
    }
    await check.record(manifest, now());
  } catch (err) {
    try {
      await deps.check.recordFailure(err instanceof Error ? err.message : String(err), deps.now());
    } catch {
      // The store itself is unavailable. Nothing useful left to do, and throwing here would
      // defeat the whole point of this catch.
    }
  }
}

export function startUpdateCheck(deps: PollDeps & {
  intervalMs?: number;
  logger?: { warn(o: unknown, m: string): void };
}): () => void {
  const interval = deps.intervalMs ?? DAY_MS;
  void pollOnce(deps);
  const timer = setInterval(() => { void pollOnce(deps); }, interval);
  // Do not hold the process open for a background check.
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
