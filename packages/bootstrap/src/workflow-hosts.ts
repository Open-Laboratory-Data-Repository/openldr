/**
 * The hosts a workflow HTTP step may call, as an administrator sets them in Settings > Network or
 * with `openldr workflows hosts`. Two sources: the server setting WORKFLOW_HTTP_ALLOWLIST, which
 * only the person who runs the server can change, and a stored list, which is changed here.
 *
 * A separate switch lets a workflow call this OpenLDR itself. It allows one origin (scheme, host
 * and port), never the host name: the same machine runs the database and other programs on other
 * ports, and a workflow must not reach those.
 */
import { isIP } from 'node:net';
import type { AppSettingStore, AppSettingUpdater } from '@openldr/db';
import { canonicalHost, parseAllowlist, type HttpAllowRule } from '@openldr/workflows';
import type { TrustActor } from './network-trust';

/** A JSON array of host names. Local to this install: it never syncs. */
export const KEY_HOSTS = 'workflows.http_hosts';
/** 'true' when a workflow may call this OpenLDR. Local to this install: it never syncs. */
export const KEY_SELF = 'workflows.http_self';

export const BAD_HOST = 'Type a host name or an IP address, with no port and no path.';
export const SERVER_HOST = 'This host comes from the server setting WORKFLOW_HTTP_ALLOWLIST.';

export type WorkflowHostAuditAction = 'network.workflow_host.add' | 'network.workflow_host.remove' | 'network.workflow_self.set';

/**
 * The setting is changed, and the audit row for the change could not be written. The change
 * stands: trying again changes nothing and so writes no row. The caller must say both things, and
 * must keep a durable line of who changed what.
 */
export class WorkflowHostAuditFailed extends Error {
  constructor(
    readonly action: WorkflowHostAuditAction,
    readonly detail: string,
    readonly actor: TrustActor,
    cause: unknown,
  ) {
    super('The change was made, but its audit record could not be written.', { cause });
    this.name = 'WorkflowHostAuditFailed';
  }
}

export interface WorkflowHostRow {
  host: string;
  source: 'setting' | 'server';
}

export interface WorkflowHosts {
  /** Server hosts first, then the stored ones, each sorted. A host in both appears once, as 'server'. */
  list(): Promise<WorkflowHostRow[]>;
  /** Answers with the host as it is stored, and whether this call changed the list. */
  add(host: string, actor: TrustActor): Promise<{ host: string; changed: boolean }>;
  /** Answers with the host as it is stored, and whether this call changed the list. */
  remove(host: string, actor: TrustActor): Promise<{ host: string; changed: boolean }>;
  self(): Promise<{ on: boolean; origin: string }>;
  /** Answers with what it applied. It does not read the setting again. */
  setSelf(on: boolean, actor: TrustActor): Promise<{ on: boolean; origin: string }>;
  /** The rule in force right now. Read from the database on every call. */
  rule(): Promise<HttpAllowRule>;
}

export interface WorkflowHostsDeps {
  appSettings: AppSettingStore & AppSettingUpdater;
  /** cfg.WORKFLOW_HTTP_ALLOWLIST */
  serverList: string;
  /** cfg.LISTEN_HOST */
  listenHost: string;
  /** cfg.PORT */
  port: number;
  audit(action: WorkflowHostAuditAction, actor: TrustActor, detail: string): Promise<void>;
}

/**
 * The one address this server answers on from its own machine. '0.0.0.0', '127.0.0.1',
 * 'localhost' and '::' give http://127.0.0.1:<port>. '::1' gives http://[::1]:<port>. Any other
 * address gives http://<that address>:<port>, with an IPv6 address in brackets.
 */
export function selfOrigin(listenHost: string, port: number): string {
  const host = listenHost.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  const name = ['0.0.0.0', '127.0.0.1', 'localhost', '::', ''].includes(host) ? '127.0.0.1' : isIP(host) === 6 ? `[${host}]` : host;
  return `http://${name}:${port}`;
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The host in its stored form, or undefined when the text is not a host name or an IP address. */
function hostOf(raw: string): string | undefined {
  const text = raw.trim().toLowerCase();
  const unwrapped = /^\[(.*)\]$/.exec(text);
  // An IPv6 address is kept in the short form a URL gives it, so it matches a request's URL.
  if (unwrapped) return isIP(unwrapped[1] as string) === 6 ? canonicalHost(text) : undefined;
  if (isIP(text) === 6) return canonicalHost(text);
  if (isIP(text) === 4) return text;
  if (text.length === 0 || text.length > 253) return undefined;
  if (!text.split('.').every((label) => LABEL.test(label))) return undefined;
  // A URL reads some names as numbers: `127.1`, `010.0.0.1` and `2130706433` all become another
  // address. Such a name would be stored and never match, so it is refused.
  try {
    return new URL(`http://${text}`).hostname === text ? text : undefined;
  } catch {
    return undefined;
  }
}

function need(raw: string): string {
  const host = hostOf(raw);
  if (host === undefined) throw new Error(BAD_HOST);
  return host;
}

/** The stored hosts. A value that is damaged, or an entry that is not a host, allows nothing. */
function parseStored(value: string | null | undefined): string[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every((h) => typeof h === 'string')) return [];
  const hosts = (parsed as string[]).map(hostOf).filter((h): h is string => h !== undefined);
  return [...new Set(hosts)].sort();
}

export function createWorkflowHosts(deps: WorkflowHostsDeps): WorkflowHosts {
  // The server setting is read as the HTTP step has always read it, so nothing it allowed is lost.
  // Both are worked out when asked for, as the HTTP step did, not when the context is built.
  const server = (): string[] => [...new Set(parseAllowlist(deps.serverList).map(canonicalHost))].sort();
  const origin = (): string => selfOrigin(deps.listenHost, deps.port);

  const stored = async (): Promise<string[]> => parseStored((await deps.appSettings.get(KEY_HOSTS))?.value);
  const selfOn = async (): Promise<boolean> => (await deps.appSettings.get(KEY_SELF))?.value === 'true';
  const by = (actor: TrustActor): string | null => actor.actorId ?? null;
  const audited = async (action: WorkflowHostAuditAction, actor: TrustActor, detail: string): Promise<void> => {
    try {
      await deps.audit(action, actor, detail);
    } catch (err) {
      throw new WorkflowHostAuditFailed(action, detail, actor, err);
    }
  };

  return {
    async list() {
      const fromServer = server();
      const mine = (await stored()).filter((h) => !fromServer.includes(h));
      return [...fromServer.map((host) => ({ host, source: 'server' as const })), ...mine.map((host) => ({ host, source: 'setting' as const }))];
    },

    async add(raw, actor) {
      const host = need(raw);
      if (server().includes(host)) return { host, changed: false };
      let changed = false;
      await deps.appSettings.update(
        KEY_HOSTS,
        (old) => {
          const now = parseStored(old);
          changed = !now.includes(host);
          return JSON.stringify(changed ? [...now, host].sort() : now);
        },
        by(actor),
      );
      if (changed) await audited('network.workflow_host.add', actor, host);
      return { host, changed };
    },

    async remove(raw, actor) {
      const host = need(raw);
      if (server().includes(host)) throw new Error(SERVER_HOST);
      let changed = false;
      await deps.appSettings.update(
        KEY_HOSTS,
        (old) => {
          const now = parseStored(old);
          changed = now.includes(host);
          return JSON.stringify(now.filter((h) => h !== host));
        },
        by(actor),
      );
      if (changed) await audited('network.workflow_host.remove', actor, host);
      return { host, changed };
    },

    async self() {
      return { on: await selfOn(), origin: origin() };
    },

    async setSelf(on, actor) {
      let changed = false;
      await deps.appSettings.update(
        KEY_SELF,
        (old) => {
          changed = (old === 'true') !== on;
          return on ? 'true' : 'false';
        },
        by(actor),
      );
      if (changed) await audited('network.workflow_self.set', actor, on ? 'on' : 'off');
      return { on, origin: origin() };
    },

    async rule() {
      const [mine, on] = await Promise.all([stored(), selfOn()]);
      return { hosts: [...new Set([...server(), ...mine])].sort(), origins: on ? [origin()] : [] };
    },
  };
}
