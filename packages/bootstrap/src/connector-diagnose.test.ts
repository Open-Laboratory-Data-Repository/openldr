import { describe, expect, it, vi } from 'vitest';
import type { ConnectorDb } from './connector-db';
import {
  classifyConnectError, diagnoseConnector, parseBrowserReply, DIAGNOSE_HINT_TEXT,
  type DiagnoseDeps, type DiagnoseResult,
} from './connector-diagnose';

// Every probe is faked: these tests open no socket and need no server.
function fakeDb(versionRow = 'PostgreSQL 16.4 on x86_64\nsecond line', fail?: Error): { make: NonNullable<DiagnoseDeps['sqlDb']>; closed: () => boolean; queries: string[] } {
  let closed = false;
  const queries: string[] = [];
  const db: ConnectorDb = {
    async query(sql) {
      queries.push(sql);
      if (fail) throw fail;
      return { rows: sql === 'select 1' ? [{ one: 1 }] : [{ version: versionRow }] };
    },
    async close() { closed = true; },
  };
  return { make: () => db, closed: () => closed, queries };
}

function deps(over: Partial<DiagnoseDeps> = {}): DiagnoseDeps {
  return {
    lookup: async () => '10.0.0.5',
    tcpProbe: async () => {},
    browserProbe: async () => 1433,
    sqlDb: fakeDb().make,
    test: async () => {},
    ...over,
  };
}

const summary = (r: DiagnoseResult) => r.steps.map((s) => `${s.id}:${s.status}${s.hint ? `:${s.hint}` : ''}`);
const pg = { host: 'db.lab', port: '5432', database: 'lab', user: 'u', password: 'secret-pw' };

describe('diagnoseConnector', () => {
  it('passes every step for a reachable postgres server and closes the connection', async () => {
    const db = fakeDb();
    const r = await diagnoseConnector('postgres', pg, deps({ sqlDb: db.make }));
    expect(summary(r)).toEqual(['config:pass', 'dns:pass', 'tcp:pass', 'login:pass', 'version:pass']);
    expect(r.ok).toBe(true);
    expect(r.steps[1].detail).toContain('10.0.0.5');
    expect(r.steps[4].detail).toBe('PostgreSQL 16.4 on x86_64');
    expect(db.queries).toEqual(['select 1', 'select version() as version']);
    expect(db.closed()).toBe(true);
  });

  it('warns that localhost is the CE container, and still runs the later steps', async () => {
    const r = await diagnoseConnector('postgres', { ...pg, host: 'localhost' }, deps());
    expect(summary(r)).toEqual(['config:warn:localhostInContainer', 'dns:pass', 'tcp:pass', 'login:pass', 'version:pass']);
    expect(r.ok).toBe(true);
  });

  it('fails on an empty host and skips everything after it', async () => {
    const r = await diagnoseConnector('postgres', { ...pg, host: '' }, deps());
    expect(summary(r)).toEqual(['config:fail:missingHost', 'dns:skip', 'tcp:skip', 'login:skip', 'version:skip']);
    expect(r.ok).toBe(false);
  });

  it('fails on a port that is not a port', async () => {
    const r = await diagnoseConnector('postgres', { ...pg, port: '99999' }, deps());
    expect(summary(r)[0]).toBe('config:fail:badPort');
  });

  it('stops at a name that does not resolve', async () => {
    const r = await diagnoseConnector('postgres', pg, deps({ lookup: async () => { throw new Error('getaddrinfo ENOTFOUND db.lab'); } }));
    expect(summary(r)).toEqual(['config:pass', 'dns:fail:dnsFailed', 'tcp:skip', 'login:skip', 'version:skip']);
  });

  it.each([
    ['ECONNREFUSED', 'tcpRefused'],
    ['ETIMEDOUT', 'tcpTimeout'],
    ['EHOSTUNREACH', 'tcpUnreachable'],
    ['ENETUNREACH', 'tcpUnreachable'],
  ])('names a %s on the port as %s', async (code, hint) => {
    const err = Object.assign(new Error(`connect ${code}`), { code });
    const r = await diagnoseConnector('postgres', pg, deps({ tcpProbe: async () => { throw err; } }));
    expect(summary(r)).toEqual(['config:pass', 'dns:pass', `tcp:fail:${hint}`, 'login:skip', 'version:skip']);
  });

  it('probes the TCP port SQL Browser reports for a named instance', async () => {
    const tcpProbe = vi.fn(async () => {});
    const r = await diagnoseConnector('microsoft-sql', { host: 'LABSRV', instanceName: 'SQLEXPRESS', user: 'u', password: 'p' },
      deps({ browserProbe: async () => 49172, tcpProbe, sqlDb: fakeDb('Microsoft SQL Server 2012 (SP4)').make }));
    expect(summary(r)).toEqual(['config:pass', 'dns:pass', 'browser:pass', 'tcp:pass', 'login:pass', 'version:pass']);
    expect(tcpProbe).toHaveBeenCalledWith('LABSRV', 49172, 5000);
  });

  it('reads the instance from the SERVER\\INSTANCE host form', async () => {
    const lookup = vi.fn(async () => '10.0.0.9');
    const browserProbe = vi.fn(async () => 1500);
    await diagnoseConnector('microsoft-sql', { host: 'LABSRV\\SQLEXPRESS' }, deps({ lookup, browserProbe }));
    expect(lookup).toHaveBeenCalledWith('LABSRV');
    expect(browserProbe).toHaveBeenCalledWith('LABSRV', 'SQLEXPRESS', 3000);
  });

  it('fails the browser step when the instance is not listed', async () => {
    const r = await diagnoseConnector('microsoft-sql', { host: 'LABSRV', instanceName: 'NOPE' }, deps({ browserProbe: async () => null }));
    expect(summary(r).slice(2)).toEqual(['browser:fail:browserNoInstance', 'tcp:skip', 'login:skip', 'version:skip']);
  });

  it('fails the browser step when SQL Browser does not answer', async () => {
    const r = await diagnoseConnector('microsoft-sql', { host: 'LABSRV', instanceName: 'A' }, deps({ browserProbe: async () => { throw new Error('timed out'); } }));
    expect(summary(r)[2]).toBe('browser:fail:browserNoAnswer');
  });

  it('has no browser step for a SQL Server without an instance', async () => {
    const r = await diagnoseConnector('microsoft-sql', { host: 'LABSRV', port: '1433' }, deps());
    expect(r.steps.map((s) => s.id)).toEqual(['config', 'dns', 'tcp', 'login', 'version']);
  });

  it('names a failed login, skips the version, and still closes the connection', async () => {
    const db = fakeDb('', new Error("Login failed for user 'reader'."));
    const r = await diagnoseConnector('microsoft-sql', { host: 'LABSRV', port: '1433' }, deps({ sqlDb: db.make }));
    expect(summary(r).slice(3)).toEqual(['login:fail:loginFailed', 'version:skip']);
    expect(db.closed()).toBe(true);
  });

  it('masks the stored password if the driver echoes it', async () => {
    const db = fakeDb('', new Error('bad login for secret-pw at postgres://u:secret-pw@db.lab'));
    const r = await diagnoseConnector('postgres', pg, deps({ sqlDb: db.make }));
    expect(r.steps[3].detail).not.toContain('secret-pw');
  });

  it('uses the plain connector test for redis and has no version step', async () => {
    const test = vi.fn(async () => {});
    const r = await diagnoseConnector('redis', { host: 'cache', port: '6379' }, deps({ test }));
    expect(summary(r)).toEqual(['config:pass', 'dns:pass', 'tcp:pass', 'login:pass']);
    expect(test).toHaveBeenCalledWith('redis', { host: 'cache', port: '6379' });
  });

  it('only runs the login step for gmail, which has no host to probe', async () => {
    const r = await diagnoseConnector('gmail', { user: 'lab@example.test' }, deps());
    expect(summary(r)).toEqual(['login:pass']);
  });
});

describe('classifyConnectError', () => {
  it.each([
    ["Login failed for user 'reader'.", 'loginFailed'],
    ['password authentication failed for user "u"', 'loginFailed'],
    ['role "nobody" does not exist', 'loginFailed'],
    ["Access denied for user 'u'@'10.0.0.1' (using password: YES)", 'loginFailed'],
    ['Cannot open database "DisalabData" requested by the login. The login failed.', 'databaseMissing'],
    ['database "lab" does not exist', 'databaseMissing'],
    ["Unknown database 'lab'", 'databaseMissing'],
    ['Failed to connect to LABSRV:1433 - self-signed certificate', 'tlsCertificate'],
    ['unable to verify the first certificate', 'tlsCertificate'],
    ['Failed to connect: unsupported protocol', 'tlsOldServer'],
    ['SSL routines:ssl3_get_record:wrong version number', 'tlsOldServer'],
    ['no protocols available', 'tlsOldServer'],
    ['Connection lost - socket hang up', 'connectFailed'],
  ])('%s -> %s', (message, hint) => {
    expect(classifyConnectError(message)).toBe(hint);
  });

  it('has English text for every hint', () => {
    for (const text of Object.values(DIAGNOSE_HINT_TEXT)) expect(text.length).toBeGreaterThan(10);
  });
});

describe('parseBrowserReply', () => {
  const reply = 'ServerName;LABSRV;InstanceName;MSSQLSERVER;IsClustered;No;Version;11.0.7001.0;tcp;1433;;'
    + 'ServerName;LABSRV;InstanceName;SQLEXPRESS;IsClustered;No;Version;11.0.7001.0;tcp;49172;;';
  it('finds the instance port, ignoring case', () => {
    expect(parseBrowserReply(reply, 'sqlexpress')).toBe(49172);
  });
  it('returns null for an instance that is not listed', () => {
    expect(parseBrowserReply(reply, 'OTHER')).toBeNull();
  });
  it('returns null for an instance with no TCP port (TCP/IP disabled)', () => {
    expect(parseBrowserReply('ServerName;LABSRV;InstanceName;NP;IsClustered;No;np;\\\\LABSRV\\pipe\\sql;;', 'NP')).toBeNull();
  });
});
