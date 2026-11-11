import { promises as dnsPromises } from 'node:dns';
import { connect } from 'node:net';
import { createSocket } from 'node:dgram';
import { makeRedactor, redact } from '@openldr/core';
import { createConnectorDb, splitMssqlHost, validatePort, type ConnectorDb } from './connector-db';
import { testConnector } from './connector-test';

// Step-by-step connection check for a host connector. A plain "Test" reports only the driver's last
// error, which rarely says whether the name, the port, the firewall, TLS or the login is wrong. This
// runs those checks in order, stops at the first failure, and names the likely fix with a hint code.
// The studio translates the codes; the CLI prints DIAGNOSE_HINT_TEXT.

export type DiagnoseStepId = 'config' | 'dns' | 'browser' | 'tcp' | 'login' | 'version';
export type DiagnoseStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type DiagnoseHint =
  | 'missingHost' | 'badPort' | 'localhostInContainer' | 'dnsFailed'
  | 'browserNoAnswer' | 'browserNoInstance'
  | 'tcpRefused' | 'tcpTimeout' | 'tcpUnreachable'
  | 'loginFailed' | 'databaseMissing' | 'tlsCertificate' | 'tlsOldServer' | 'connectFailed';

export interface DiagnoseStep { id: DiagnoseStepId; status: DiagnoseStatus; detail?: string; hint?: DiagnoseHint }
export interface DiagnoseResult { ok: boolean; steps: DiagnoseStep[] }

export interface DiagnoseDeps {
  lookup?: (host: string) => Promise<string>;
  tcpProbe?: (host: string, port: number, timeoutMs: number) => Promise<void>;
  /** The TCP port SQL Browser reports for the instance, or null when the instance is not listed. */
  browserProbe?: (host: string, instance: string, timeoutMs: number) => Promise<number | null>;
  sqlDb?: (type: string, config: Record<string, string>) => ConnectorDb;
  test?: (type: string, config: Record<string, string>) => Promise<void>;
}

export const DIAGNOSE_HINT_TEXT: Record<DiagnoseHint, string> = {
  missingHost: 'Enter the server name or IP address.',
  badPort: 'The port must be a number from 1 to 65535.',
  localhostInContainer: 'When CE runs in Docker, localhost is the CE container itself. Use the server name or IP address of the machine that runs the database.',
  dnsFailed: 'This name does not resolve from the CE server. Use the IP address, or add the name to DNS or the hosts file.',
  browserNoAnswer: 'SQL Server Browser did not answer on UDP port 1434. Start the SQL Server Browser service, open UDP 1434 in the firewall, or clear the instance name and enter the instance\'s fixed TCP port.',
  browserNoInstance: 'SQL Server Browser answered, but this instance is not listed or has TCP/IP turned off. Check the instance name, and enable TCP/IP in SQL Server Configuration Manager.',
  tcpRefused: 'The server answered, but nothing listens on this port. Check the port, and that TCP/IP is enabled for the database.',
  tcpTimeout: 'No answer on this port. A firewall on the database server or the network is likely blocking it.',
  tcpUnreachable: 'The CE server has no network route to this address. Check the VPN or network link between the two machines.',
  loginFailed: 'The server refused the login. Check the user and password. For SQL Server, check that SQL logins are allowed, or fill in the Windows domain for a Windows account.',
  databaseMissing: 'The login worked, but the database does not exist or this user cannot open it. Check the database name and the user\'s access.',
  tlsCertificate: 'The server uses a certificate CE does not trust. For a server inside the lab network, turn on "Trust server certificate".',
  tlsOldServer: 'The server only offers an old TLS version that CE refuses. Turn Encrypt off for this connector, or update the SQL Server.',
  connectFailed: 'The connection failed after the port opened. See the detail for the driver\'s message.',
};

const SQL_TYPES = new Set(['postgres', 'mysql', 'microsoft-sql']);
// No host or port to probe: the provider's own endpoint is fixed, so only the login is checked.
const LOGIN_ONLY = new Set(['gmail', 'outlook']);
const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432, mysql: 3306, 'microsoft-sql': 1433, mongodb: 27017, redis: 6379, smtp: 587, imap: 993, sftp: 22,
};
const VERSION_SQL: Record<string, string> = {
  'microsoft-sql': 'select @@version as version',
  postgres: 'select version() as version',
  mysql: 'select version() as version',
};
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const NET_TIMEOUT_MS = 5000;
const BROWSER_TIMEOUT_MS = 3000;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Map a driver error message to a hint. Order matters: SQL Server's "Cannot open database"
 *  message also says "The login failed", so the database rule runs first. */
export function classifyConnectError(message: string): DiagnoseHint {
  const m = message.toLowerCase();
  if (m.includes('cannot open database') || /database ".*" does not exist/.test(m) || m.includes('unknown database')) return 'databaseMissing';
  if (m.includes('login failed') || m.includes('password authentication failed') || m.includes('access denied') || /role ".*" does not exist/.test(m)) return 'loginFailed';
  if (m.includes('self signed') || m.includes('self-signed') || m.includes('certificate')) return 'tlsCertificate';
  if (m.includes('unsupported protocol') || m.includes('wrong version number') || m.includes('no protocols available')) return 'tlsOldServer';
  return 'connectFailed';
}

function tcpHint(e: unknown): DiagnoseHint {
  const code = (e as { code?: string } | null)?.code;
  if (code === 'ECONNREFUSED') return 'tcpRefused';
  if (code === 'ETIMEDOUT' || /timed out/i.test(errorText(e))) return 'tcpTimeout';
  return 'tcpUnreachable';
}

/** Read the TCP port for one instance out of a SQL Browser reply (records end in `;;`). */
export function parseBrowserReply(reply: string, instance: string): number | null {
  for (const record of reply.split(';;')) {
    const parts = record.split(';');
    const fields = new Map<string, string>();
    for (let i = 0; i + 1 < parts.length; i += 2) fields.set(parts[i], parts[i + 1]);
    if ((fields.get('InstanceName') ?? '').toUpperCase() !== instance.toUpperCase()) continue;
    const port = Number.parseInt(fields.get('tcp') ?? '', 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  }
  return null;
}

async function realLookup(host: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      dnsPromises.lookup(host),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('name lookup timed out')), NET_TIMEOUT_MS); }),
    ]);
    return result.address;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function realTcpProbe(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(Object.assign(new Error(`no answer on port ${port} within ${timeoutMs} ms`), { code: 'ETIMEDOUT' })); });
    socket.once('error', (e) => { socket.destroy(); reject(e); });
  });
}

/** Ask SQL Browser (UDP 1434) for every instance, the same request tedious sends (0x02). */
function realBrowserProbe(host: string, instance: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); reject(new Error(`no reply from SQL Server Browser within ${timeoutMs} ms`)); }, timeoutMs);
    socket.once('error', (e) => { clearTimeout(timer); socket.close(); reject(e); });
    socket.once('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      // The first three bytes are a header; the rest is ASCII.
      resolve(parseBrowserReply(msg.toString('ascii', 3), instance));
    });
    socket.send(Buffer.from([0x02]), 1434, host, (e) => {
      if (e) { clearTimeout(timer); socket.close(); reject(e); }
    });
  });
}

export async function diagnoseConnector(
  type: string,
  config: Record<string, string>,
  deps: DiagnoseDeps = {},
): Promise<DiagnoseResult> {
  const lookup = deps.lookup ?? realLookup;
  const tcpProbe = deps.tcpProbe ?? realTcpProbe;
  const browserProbe = deps.browserProbe ?? realBrowserProbe;
  const sqlDb = deps.sqlDb ?? ((t, c) => createConnectorDb(t, c));
  const test = deps.test ?? testConnector;

  const secrets = makeRedactor([config.password, config.clientSecret, config.refreshToken].filter((v): v is string => Boolean(v)));
  const clean = (text: string) => redact(secrets(text));
  const isSql = SQL_TYPES.has(type);

  // The step list is fixed up front, so a failure can mark every later step as skipped.
  const mssql = type === 'microsoft-sql' ? splitMssqlHost(config.host ?? '', config.instanceName) : null;
  const host = (mssql ? mssql.host : config.host ?? '').trim();
  const instance = mssql?.instanceName;
  const ids: DiagnoseStepId[] = LOGIN_ONLY.has(type)
    ? ['login']
    : ['config', 'dns', ...(instance ? ['browser' as const] : []), 'tcp', 'login', ...(isSql ? ['version' as const] : [])];

  const steps: DiagnoseStep[] = [];
  const finish = (): DiagnoseResult => {
    for (const id of ids.slice(steps.length)) steps.push({ id, status: 'skip' });
    return { ok: !steps.some((s) => s.status === 'fail'), steps };
  };
  const fail = (id: DiagnoseStepId, hint: DiagnoseHint, detail?: string): DiagnoseResult => {
    steps.push({ id, status: 'fail', hint, ...(detail ? { detail: clean(detail) } : {}) });
    return finish();
  };

  let port = DEFAULT_PORTS[type] ?? 0;
  if (ids.includes('config')) {
    if (!host) return fail('config', 'missingHost');
    if (!instance) {
      try { port = validatePort(config.port || undefined, port); } catch { return fail('config', 'badPort', `port ${config.port}`); }
    }
    const where = instance ? `${host}\\${instance}` : `${host}:${port}`;
    steps.push(LOCAL_HOSTS.has(host.toLowerCase())
      ? { id: 'config', status: 'warn', hint: 'localhostInContainer', detail: where }
      : { id: 'config', status: 'pass', detail: where });

    try {
      steps.push({ id: 'dns', status: 'pass', detail: `${host} resolved to ${await lookup(host)}` });
    } catch (e) { return fail('dns', 'dnsFailed', errorText(e)); }

    if (instance) {
      let found: number | null;
      try { found = await browserProbe(host, instance, BROWSER_TIMEOUT_MS); } catch (e) { return fail('browser', 'browserNoAnswer', errorText(e)); }
      if (found === null) return fail('browser', 'browserNoInstance', `instance ${instance}`);
      port = found;
      steps.push({ id: 'browser', status: 'pass', detail: `instance ${instance} listens on TCP port ${port}` });
    }

    try {
      await tcpProbe(host, port, NET_TIMEOUT_MS);
      steps.push({ id: 'tcp', status: 'pass', detail: `port ${port} is open` });
    } catch (e) { return fail('tcp', tcpHint(e), errorText(e)); }
  }

  if (!isSql) {
    try {
      await test(type, config);
      steps.push({ id: 'login', status: 'pass' });
    } catch (e) { return fail('login', classifyConnectError(errorText(e)), errorText(e)); }
    return finish();
  }

  let db: ConnectorDb | undefined;
  try {
    try {
      db = sqlDb(type, config);
      await db.query('select 1');
      steps.push({ id: 'login', status: 'pass' });
    } catch (e) { return fail('login', classifyConnectError(errorText(e)), errorText(e)); }
    try {
      const { rows } = await db.query(VERSION_SQL[type]);
      const version = String(rows[0]?.version ?? '').split('\n')[0].trim().slice(0, 120);
      steps.push({ id: 'version', status: 'pass', detail: version });
    } catch (e) { return fail('version', 'connectFailed', errorText(e)); }
    return finish();
  } finally {
    await db?.close().catch(() => {});
  }
}
