# SQL Server connector fixes and connection diagnosis: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can connect CE to a SQL Server named instance or with a Windows login, and
can see which step of a failed connection broke and what to do about it.

**Architecture:** All connection code stays in `@openldr/bootstrap`. The mssql adapter gains
two optional config fields. A new `connector-diagnose.ts` runs ordered probes (config, DNS,
SQL Browser, TCP, login, version) with injectable dependencies, and returns codes. The
server route, the CLI and the studio Sheet all call that one function.

**Tech stack:** tedious 18.6.2 (NTLM uses `js-md4`, so OpenSSL 3 is fine), node `dns`,
`net`, `dgram`, Fastify, commander, React with shadcn.

**Spec:** `docs/superpowers/specs/2026-11-11-studio-customization-and-helper-plugins-design.md`,
sections 3 and 4.2 (A1). Slices 1 and 2.

## Global constraints

- Tedious refuses `port` and `instanceName` together (`tedious/lib/connection.js:492`).
  When an instance name is set, never pass a port.
- Connector secrets never reach a response, a log line or an audit row. Error text goes
  through `redact` from `@openldr/core`.
- UI rules from AGENTS.md §5: actions in a `MoreHorizontal` menu, a Sheet not a Dialog,
  label left and input right, `LoadingState` while running.
- CLI audits as `actorName: 'cli'`. Diagnose is read-only, so no `--force`.
- Docs: new files only. Do not edit `apps/studio/src/docs/registry.ts` or any existing page.
- No em dashes in any new text.

## Review focus

1. Host typed as `LABSRV\SQLEXPRESS` (what SSMS shows). Expect it to split into host and
   instance, not fail DNS on the whole string. Test in Task 1.
2. Encrypt left untouched on a new SQL Server connector. Expect the switch to show ON,
   because the server encrypts when the field is unset (`connector-db.ts:88`). Test in Task 2.
3. Host is `localhost` or `127.0.0.1`. Expect a warning that this is the CE container when
   CE runs in Docker, and the remaining steps still run. Test in Task 3.
4. A step fails. Expect every later step to be `skip`, not a second confusing failure.
   Test in Task 3.
5. Driver error text contains the password. Expect it redacted in the route response.
   Test in Task 4.

---

### Task 1: Named instance and Windows login in the adapter and connector

**Files:**
- Modify: `packages/adapter-mssql-store/src/index.ts` (config type, `buildMssqlDialectConfig`)
- Modify: `packages/bootstrap/src/connector-db.ts` (microsoft-sql branch)
- Modify: `packages/bootstrap/src/connector-config.ts:14` (allowed fields)
- Test: `packages/adapter-mssql-store/src/index.test.ts`, `packages/bootstrap/src/connector-db.test.ts`,
  `packages/bootstrap/src/connector-config.test.ts`

**Interfaces:**
- Produces: `MssqlStoreConfig` gains `instanceName?: string` and `domain?: string`.
- Produces: `splitMssqlHost(host: string, instanceName?: string): { host: string; instanceName?: string }`
  exported from `connector-db.ts`. An explicit `instanceName` wins over one in the host.
- Produces: connector config keys `instanceName` and `domain` for `microsoft-sql`.

- [ ] Tests for `buildMssqlDialectConfig`: add an optional third parameter
  `Connection: typeof tedious.Connection = tedious.Connection`, pass a fake that records its
  config, call `connectionFactory()`. Assert:
  - `{ domain: 'LAB' }` gives `authentication: { type: 'ntlm', options: { userName, password, domain: 'LAB' } }`.
  - no domain gives `type: 'default'` (unchanged).
  - `{ instanceName: 'SQLEXPRESS', port: 1433 }` gives `options.instanceName === 'SQLEXPRESS'` and no `options.port`.
- [ ] Tests for `splitMssqlHost`: `'LABSRV\\SQLEXPRESS'` gives `{ host: 'LABSRV', instanceName: 'SQLEXPRESS' }`;
  `'LABSRV'` gives `{ host: 'LABSRV' }`; `('LABSRV\\A', 'B')` gives instance `'B'`;
  a blank instance after the backslash is ignored.
- [ ] Test in `connector-config.test.ts`: an update patch with `instanceName` and `domain`
  is accepted for `microsoft-sql` and both show in `inspectConnectorConfig`.
- [ ] Run the three test files, see them fail.
- [ ] Implement. In `connector-db.ts`, run `splitMssqlHost` before `createMssqlStore`, and
  only call `validatePort` when there is no instance name.
- [ ] Run, see them pass. Commit `feat(connectors): SQL Server named instances and Windows login`.

### Task 2: Studio form fields and the Encrypt default

**Files:**
- Modify: `apps/studio/src/pages/settings/Connectors.tsx:57-65` and the boolean field render
- Modify: studio i18n files for en, fr, pt (keys below)
- Test: `apps/studio/src/pages/settings/Connectors.test.tsx`

**Interfaces:**
- `TypeField` gains `defaultOn?: boolean`. The switch shows checked when the value is
  `'true'`, or when the value is unset and `defaultOn` is true.
- New i18n keys: `settings.connectors.fieldInstanceName`, `settings.connectors.fieldDomain`.

- [ ] Test: open Add, pick database, pick Microsoft SQL. Expect inputs
  `connector-db-instanceName` and `connector-db-domain`, and `connector-db-encrypt` checked.
- [ ] Run, fail. Implement: field order host, instanceName, port, database, domain, user,
  password, encrypt, trustServerCertificate; `defaultOn: true` on encrypt.
- [ ] Run, pass. Commit `fix(studio): SQL Server form shows Encrypt on, adds instance and domain`.

### Task 3: Diagnosis engine

**Files:**
- Create: `packages/bootstrap/src/connector-diagnose.ts`
- Create: `packages/bootstrap/src/connector-diagnose.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export)

**Interfaces:**
```ts
export type DiagnoseStepId = 'config' | 'dns' | 'browser' | 'tcp' | 'login' | 'version';
export type DiagnoseStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type DiagnoseHint =
  | 'missingHost' | 'localhostInContainer' | 'dnsFailed'
  | 'browserNoAnswer' | 'browserNoInstance'
  | 'tcpRefused' | 'tcpTimeout' | 'tcpUnreachable'
  | 'loginFailed' | 'databaseMissing' | 'tlsCertificate' | 'tlsOldServer' | 'connectFailed';
export interface DiagnoseStep { id: DiagnoseStepId; status: DiagnoseStatus; detail?: string; hint?: DiagnoseHint }
export interface DiagnoseResult { ok: boolean; steps: DiagnoseStep[] }
export interface DiagnoseDeps {
  lookup?: (host: string) => Promise<string>;
  tcpProbe?: (host: string, port: number, timeoutMs: number) => Promise<void>;
  browserProbe?: (host: string, instance: string, timeoutMs: number) => Promise<number | null>;
  sqlDb?: (type: string, config: Record<string, string>) => ConnectorDb;
  test?: (type: string, config: Record<string, string>) => Promise<void>;
}
export async function diagnoseConnector(type: string, config: Record<string, string>, deps?: DiagnoseDeps): Promise<DiagnoseResult>;
export const DIAGNOSE_HINT_TEXT: Record<DiagnoseHint, string>; // English, for the CLI
export function classifyConnectError(message: string): DiagnoseHint;
```
- `ok` is true when no step failed. A `warn` does not make it false.
- Default ports: postgres 5432, mysql 3306, microsoft-sql 1433, mongodb 27017, redis 6379,
  smtp 587, imap 993, sftp 22. gmail and outlook skip config, DNS and TCP and go straight
  to the existing `testConnector` as the `login` step.
- `browser` runs only for microsoft-sql with an instance name. It sends the SQL Browser
  `CLNT_UCAST_INST` request (byte `0x04` then the instance name, ASCII) to UDP 1434 and reads
  `tcp;<port>` from the reply. A port found here is the one `tcp` probes.
- `login` opens a connection and runs `select 1` (SQL types) or calls `testConnector`.
- `version` runs only for SQL types: `select @@version as version` (mssql),
  `select version() as version` (postgres, mysql). Detail is the first line, cut to 120 chars.
- Timeouts: DNS and TCP 5000 ms, browser 3000 ms.
- `classifyConnectError` rules, case-insensitive on the message, first match wins:
  - `login failed`, `password authentication failed`, `access denied` gives `loginFailed`
  - `cannot open database`, `does not exist`, `unknown database` gives `databaseMissing`
  - `self signed`, `self-signed`, `certificate` gives `tlsCertificate`
  - `unsupported protocol`, `wrong version number`, `no protocols available` gives `tlsOldServer`
  - anything else gives `connectFailed`

- [ ] Tests, all with fake deps, no network:
  - postgres happy path: `config pass, dns pass, tcp pass, login pass, version pass`, `ok: true`.
  - host `localhost`: `config` is `warn` with hint `localhostInContainer`, later steps still run.
  - empty host: `config fail missingHost`, every later step `skip`, `ok: false`.
  - DNS throws: `dns fail dnsFailed`, then `tcp`, `login`, `version` all `skip`.
  - TCP error code `ECONNREFUSED` gives `tcpRefused`; `ETIMEDOUT` or a timeout gives
    `tcpTimeout`; `EHOSTUNREACH` gives `tcpUnreachable`.
  - mssql with `instanceName: 'SQLEXPRESS'`: browser returns 49172, tcp probe is called
    with 49172. Browser returns null: `browser fail browserNoInstance`. Browser throws:
    `browser fail browserNoAnswer`.
  - mssql host `LABSRV\SQLEXPRESS` uses `splitMssqlHost`, so DNS looks up `LABSRV`.
  - login error `Login failed for user 'x'` gives `login fail loginFailed`, `version skip`.
  - `classifyConnectError` table test over every rule above.
  - redis uses the `test` dep for `login` and has no `version` step.
  - gmail: steps are only `login`.
- [ ] Run, fail. Implement. Real `lookup` uses `dns.promises.lookup`; real `tcpProbe` uses
  `net.connect` with a timer; real `browserProbe` uses `dgram`. Always close the db in `finally`.
- [ ] Run, pass. Commit `feat(connectors): step-by-step connection diagnosis`.

### Task 4: Server route

**Files:**
- Modify: `apps/server/src/connectors-routes.ts` (new route after `/test`)
- Test: `apps/server/src/connectors-routes.test.ts`

**Interfaces:**
- `POST /api/connectors/:id/diagnose`, capability `connectors.manage`.
- 404 when the connector is missing. 400 `{ error: 'diagnosis is for host connectors' }`
  when it has no `type`.
- 200 with `DiagnoseResult`, every `detail` passed through `redact`.
- Audit `connector.diagnose` with `metadata: { ok, failedStep }`. Never the detail.
- `ConnectorsRouteDeps.diagnose?` defaults to `diagnoseConnector` so the test injects a fake.

- [ ] Tests: 404; 400 for a plugin connector; 200 shape; a detail containing the stored
  password comes back redacted; an audit row is written with `ok` and `failedStep`.
- [ ] Run, fail. Implement. Run, pass. Run `pnpm --filter @openldr/server lint`.
- [ ] Commit `feat(server): connector diagnosis route`.

### Task 5: CLI

**Files:**
- Modify: `packages/cli/src/connectors.ts` (add `runConnectorDiagnose`)
- Modify: `packages/cli/src/program.ts` (register `connectors diagnose <id> [--json]`)
- Test: `packages/cli/src/connectors.test.ts`

**Interfaces:**
- `formatDiagnose(result: DiagnoseResult): string` (pure, tested) and
  `runConnectorDiagnose(id: string, opts: { json: boolean }): Promise<number>` returning 0
  when `ok`, 1 otherwise.
- Text output: one line per step, `PASS  dns      resolved to 10.0.0.5`, and for a hint an
  indented line with `DIAGNOSE_HINT_TEXT[hint]`.
- Audit `connector.diagnose` as `actorName: 'cli'`.

- [ ] Tests for `formatDiagnose`: a failing TCP step shows `FAIL` and the hint text; a skip
  shows `SKIP`. Test the command wiring the way `connectors.test.ts` tests `inspect`.
- [ ] Run, fail. Implement. Run, pass. Commit `feat(cli): openldr connectors diagnose`.

### Task 6: Studio Sheet

**Files:**
- Create: `apps/studio/src/pages/settings/ConnectorDiagnoseSheet.tsx`
- Modify: `apps/studio/src/pages/settings/Connectors.tsx` (menu item, state)
- Modify: `apps/studio/src/api.ts` (`diagnoseConnector(id)`, `DiagnoseResult` type)
- Modify: studio i18n en, fr, pt
- Test: `apps/studio/src/pages/settings/ConnectorDiagnoseSheet.test.tsx`, `Connectors.test.tsx`

**Interfaces:**
- `diagnoseConnector(id: string): Promise<DiagnoseResult>` in `api.ts`.
- `<ConnectorDiagnoseSheet connector={Connector | null} onOpenChange={(open: boolean) => void} />`.
  Runs when it opens. Header ⋯ menu has "Run again". Body: `LoadingState` while running,
  then one row per step with a status icon, the step name, the detail, and the translated hint.
- i18n keys under `settings.connectors.diagnose.*`: `menu`, `title`, `description`,
  `runAgain`, `step.<id>`, `status.<status>`, `hint.<hint>`, `allPassed`, `failed`.
- The "Diagnose" menu item shows only for host connectors (`c.type`).

- [ ] Tests: the menu item is absent for a plugin connector; opening it calls the API and
  renders each step; a failed step shows its hint text; "Run again" calls the API again.
- [ ] Run, fail. Implement. Run, pass.
- [ ] Check at 375x812 in the browser pane: Sheet fills the width, no sideways scroll.
- [ ] Commit `feat(studio): diagnose a connector from its menu`.

### Task 7: Docs

**Files (new only):**
- `apps/studio/src/docs/0.1.8/en/connector-diagnose.md`, plus `fr` and `pt`
- `apps/web/src/docs/0.1.8/connector-diagnose.md`

Content: how to fill the SQL Server form for a named instance and a Windows login, what each
diagnosis step checks, and what to do for each hint. Report the registry entry to the
coordinator; do not edit `registry.ts`.

- [ ] Run the studio and web docs tests. Commit `docs: SQL Server connections and diagnosis`.

### Task 8: Gate

- [ ] `pnpm turbo run test --force --concurrency=2 --continue > log 2>&1; echo exit=$?`
- [ ] `pnpm turbo run typecheck --force --concurrency=2 > log 2>&1; echo exit=$?`
- [ ] Grep both logs for `out of memory`, `VirtualAlloc`, `Test timed out` before reading a
  failure as a regression.

## Not in this plan

- The `connectors.diagnose` broker op for plugins. No plugin needs it until the import
  plugin (slice 5). It moves to slice 4.
- An "allow old TLS" option. Without a SQL Server 2008 or 2012 to test against, any
  setting here is a guess. The `tlsOldServer` hint tells the user to turn Encrypt off.
