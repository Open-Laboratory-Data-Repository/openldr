# Setup checks and `openldr doctor` (slice 3)

**Goal:** an admin sees, in one place, what this install still needs before it is ready, with a
link to fix each item. A headless operator gets the same list from `openldr doctor`.

**Spec:** `docs/superpowers/specs/2026-11-11-studio-customization-and-helper-plugins-design.md`,
section 4.2 A4. The operator said "Yes, slice 3" on 2026-11-11.

## 1. What exists today (checked)

- No setup page. `grep -ri "setup\|onboard\|checklist"` over `apps/studio/src` finds none.
- No top-level `openldr doctor`. `openldr roles doctor` exists and is about role drift only
  (`packages/cli/src/program.ts:375`). `openldr health` probes the four adapters only
  (`packages/cli/src/program.ts:145`).
- The header already warns when sign-in is off (`apps/studio/src/shell/AppShell.tsx:283`), but
  only as an icon with a tooltip.

Which user action is broken today: a new admin cannot tell what is left to set up without opening
every settings page, and a headless operator has no command that says "this install is not ready".

## 2. The checks

Each check is kept only if something goes wrong today when it is not met. Proof is a file and line.

| Check | Not met when | What goes wrong | Proof | Status |
|---|---|---|---|---|
| Adapters | auth, storage, eventing or the warehouse is down | CE cannot serve or store | `packages/core/src/health-registry.ts:17` | fail (degraded: warn) |
| Sign-in | `AUTH_DEV_BYPASS` is on | anyone who reaches the server is an admin | `apps/server/src/app.ts:56` | fail in production, else warn |
| Secrets key | `SECRETS_ENCRYPTION_KEY` is not set | a connector with a password cannot be saved or read | `packages/db/src/connector-store.ts:52` | warn |
| Lab name | still the shipped default `OpenLDR`, or empty | reports print the product name as the issuing lab | `packages/bootstrap/src/lab-identity-defaults.ts:13` | warn |
| Time zone | empty | the monthly transmission report counts days in UTC, a day off for evening arrivals | `packages/config/src/lab-identity.ts:85` | warn |
| Connectors | an enabled database connector does not answer | imports and queries on it fail | `packages/bootstrap/src/connector-test.ts` (`testConnector`) | fail |
| Sync | sync is on but has no central URL or site id, or its last cycle failed | results do not reach central | `packages/bootstrap/src/sync-handle.ts:34` | fail, or warn for a failed cycle |

Rules:

- Time zone is **skipped on a SQL Server warehouse**. The setting takes IANA names only and must
  stay empty there (`packages/config/src/lab-identity.ts:90`).
- Connectors is skipped when there is no enabled database connector. Sync is skipped when sync is off.
- A connector failure names the connector only. Driver text can hold hosts and users, so it stays out.
- A check that throws reports `fail` with "the check could not run". It never stops the others.
- `ok` is true when no check failed. Warnings do not make it false.

Left out, with what would bring each back:

- **Facilities, test catalog, terminology.** The design listed them. I found nothing that breaks
  when they are empty: 4,500 requests imported into a CE with none of them set. They matter to a
  lab that enters orders in CE. Bring one back when a named user action fails without it.
- **Checks added by plugins.** No plugin has one to add today.

## 3. Shape

`packages/bootstrap/src/setup-checks.ts`:

```ts
export type SetupCheckId = 'adapters' | 'signIn' | 'secretsKey' | 'labName' | 'timeZone' | 'connectors' | 'sync';
export type SetupStatus = 'pass' | 'warn' | 'fail' | 'skip';
export interface SetupCheck { id: SetupCheckId; status: SetupStatus; detail?: string; hint?: SetupHint; fix?: string }
export interface SetupReport { ok: boolean; checks: SetupCheck[] }
export function runSetupChecks(deps: SetupCheckDeps): Promise<SetupReport>
export function setupCheckDeps(ctx: AppContext): SetupCheckDeps
export const SETUP_CHECK_TITLE: Record<SetupCheckId, string>
export const SETUP_HINT_TEXT: Record<SetupHint, string>
```

`hint` is a code. Studio translates it (en, fr, pt). The CLI prints `SETUP_HINT_TEXT`. `fix` is a
studio path such as `/settings/laboratory`. Same pattern as `connector-diagnose.ts`.

## 4. Tasks

1. **Bootstrap.** `setup-checks.ts` and its test, with fake deps. One test per row of the table,
   plus: a throwing check does not stop the others; `ok` ignores warnings.
2. **CLI.** `openldr doctor [--json]` in `packages/cli/src/doctor.ts`, registered in `program.ts`.
   Exit code 1 when a check failed. Read-only, but it opens test connections with stored
   credentials, so it writes one audit row `setup.check` as `cli`, like `connectors diagnose`.
3. **Route.** `POST /api/settings/setup-checks`, capability `settings.view`, in a new file
   `apps/server/src/setup-routes.ts`. POST because it opens test connections and writes an audit
   row. Audits `setup.check` with the outcome and the failed ids.
4. **Studio.** Settings > Setup checks: a list like the diagnosis sheet, a fix link per row, Run
   again in the page's menu. `LoadingState` while it runs. Strings in en, fr, pt.
5. **Docs.** New files `setup-checks.md` for studio (en, fr, pt) and web. Nav entries go to the
   coordinator.
6. **Check.** Browser at desktop and 375x812 on a throwaway CE, then the full forced gate.

No migration. No new capability.
