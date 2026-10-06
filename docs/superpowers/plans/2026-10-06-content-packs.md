# Content Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lab installs a signed content pack (code systems, value sets, a facility register, link-matching, custom queries) from Settings, Marketplace or `openldr market install`, and the first pack, `vl-reports-mz`, is built in cdr-toolchain and published to the marketplace repo.

**Architecture:** A new marketplace artifact type `content-pack` whose one payload file is `pack.json`, an ordered list of steps. One installer in `@openldr/bootstrap` checks every step, then applies them in order through the imports that already exist, and records the result in `marketplace_installs`. The server route and the CLI both call it.

**Tech Stack:** TypeScript, zod, Kysely, pg-mem, vitest, React + shadcn (studio), Fastify.

**Spec:** `docs/superpowers/specs/2026-10-06-content-packs-design.md`

## Global Constraints

- Artifact type `content-pack`. Payload `{ kind: 'content-pack', packSha256, steps }`, `steps` = `{ kind, label, count }[]`. Payload file `pack.json`.
- `pack.json` = `{ formatVersion: 1, steps: [...] }`. Step kinds, exactly: `code-system`, `value-set`, `facility-register`, `link-matching`, `custom-queries`. Unknown version or kind: refuse before any write with `this pack needs a newer CE`.
- Install = pass 1 (check everything, write nothing), then pass 2 (apply in file order). A failure in pass 2 records `status: 'failed'`, `failed_step`, `error`; installing again finishes it.
- Register rows absent from a newer pack: `onAbsent: 'report'`, never retire.
- Custom queries: replaced by name (`replace: true`). Terminology: replaced by URL. Register source: get-or-create by URL.
- Publisher trust as for plugins: verify signature, pin the key on first use, refuse a different key for a pinned publisher.
- No capabilities on a pack (`capabilities: []`). No uninstall; detach forgets the record only.
- Internal migration `108_marketplace_install_status`: `target_form_id` nullable; add `status text not null default 'installed'`, `failed_step integer`, `error text`. Recheck no branch claims 108 before adding.
- Who installs: existing marketplace MANAGE permission. CLI audits `actorName: 'cli'`.
- Names do not use "DISA" (LST product): pack `vl-reports-mz`, publisher "OpenLDR Content Publisher", URNs `urn:openldr:mz:laboratories`, `urn:openldr:mz:poc-sites`, `urn:openldr:mz:link-sites`, register code `MZLABS`, queries "VL info", "VL results". v1 output column names (`IsDisaPoc`, `IsDisaLink`) stay.
- No lab-system content in the CE repo (AGENTS.md section 8). Test fixtures use made-up codes.
- UI per AGENTS.md section 5: actions in the `⋯` menu, shadcn only, sheets not dialogs (the install confirm prompt may stay a Dialog).
- No em dashes or emoji in new writing. Never a `Co-Authored-By` trailer.
- CE work: worktree `D:/Projects/Repositories/openldr_ce/.claude/worktrees/content-packs`, branch `spec/content-packs`. cdr work: worktree `D:/Projects/Repositories/cdr-toolchain/.claude/worktrees/content-packs`, branch `spec/content-packs` (controller creates it before Task 9). Prefix every command with `cd` to the worktree; check `git branch --show-current` before committing; stage by exact path.
- Tests: CE `pnpm --filter <pkg> exec vitest run <path>`. Never the whole `@openldr/studio` suite. Never read an exit code through a pipe: redirect, then `echo "exit=$?"`.

---

### Task 1: marketplace: the `content-pack` type and `pack.json` schema

**Files:**
- Create: `packages/marketplace/src/content-pack.ts`, `packages/marketplace/src/content-pack.test.ts`
- Modify: `packages/marketplace/src/artifact-manifest.ts:51-58` (payload union, type enum), `packages/marketplace/src/bundle-fs.ts` (`PAYLOAD_FILE`, `SHA_FIELD`), `packages/marketplace/src/pack.ts:25-29` (`SHA_FIELD`), `packages/marketplace/src/index-json.ts:5` (kind enum), `packages/marketplace/src/index.ts` (exports), `packages/marketplace/src/artifact-manifest.test.ts`, `packages/marketplace/src/index-json.test.ts`

**Interfaces:**
- Produces: `contentPackSchema`, `type ContentPack`, `type ContentPackStep`, `CONTENT_PACK_FORMAT_VERSION = 1`, `parseContentPack(raw: unknown): ContentPack` (throws `ContentPackError` with message `this pack needs a newer CE` for an unknown `formatVersion` or step `kind`), `summarizeContentPack(pack: ContentPack): { kind: string; label: string; count: number }[]`, `class ContentPackError extends Error`. Manifest payload variant `{ kind: 'content-pack'; packSha256: string; steps: { kind; label; count }[] }`.

- [ ] **Step 1: Failing tests** in `content-pack.test.ts`:
  - a pack with one step of each kind parses;
  - `formatVersion: 2` throws `this pack needs a newer CE`;
  - a step `{ kind: 'dashboard' }` throws `this pack needs a newer CE`;
  - `summarizeContentPack` gives `code-system` count 1 and label = resource `name ?? url`; `value-set` same; `facility-register` count = CSV data rows (lines after the header, blank lines ignored) and label = `name`; `link-matching` count 1, label = `registerUrl`; `custom-queries` count = `file.queries.length`, label = the query names joined with `, `.
  - In `artifact-manifest.test.ts`: a manifest with `type: 'content-pack'` and the payload above parses; one with `packSha256` not 64 hex fails.
  - In `index-json.test.ts`: kind `content-pack` parses.
- [ ] **Step 2:** run `pnpm --filter @openldr/marketplace exec vitest run src/content-pack.test.ts src/artifact-manifest.test.ts src/index-json.test.ts`, redirected; expect failures.
- [ ] **Step 3: Implement** `content-pack.ts`:

```ts
import { z } from 'zod';

export const CONTENT_PACK_FORMAT_VERSION = 1;
export class ContentPackError extends Error {}
const NEWER = 'this pack needs a newer CE';
const KINDS = ['code-system', 'value-set', 'facility-register', 'link-matching', 'custom-queries'] as const;

const fhir = (resourceType: 'CodeSystem' | 'ValueSet') =>
  z.object({ resourceType: z.literal(resourceType), url: z.string().min(1) }).passthrough();

const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code-system'), resource: fhir('CodeSystem') }),
  z.object({ kind: z.literal('value-set'), resource: fhir('ValueSet') }),
  z.object({ kind: z.literal('facility-register'), url: z.string().min(1), name: z.string().min(1), code: z.string().min(1), csv: z.string().min(1) }),
  z.object({ kind: z.literal('link-matching'), registerUrl: z.string().min(1) }),
  z.object({ kind: z.literal('custom-queries'), file: z.object({ queries: z.array(z.object({ name: z.string() }).passthrough()) }).passthrough() }),
]);

export const contentPackSchema = z.object({ formatVersion: z.literal(CONTENT_PACK_FORMAT_VERSION), steps: z.array(stepSchema).min(1) });
export type ContentPack = z.infer<typeof contentPackSchema>;
export type ContentPackStep = ContentPack['steps'][number];

export function parseContentPack(raw: unknown): ContentPack {
  const head = raw as { formatVersion?: unknown; steps?: unknown } | null;
  if (!head || head.formatVersion !== CONTENT_PACK_FORMAT_VERSION) throw new ContentPackError(NEWER);
  if (Array.isArray(head.steps) && head.steps.some((s) => !KINDS.includes((s as { kind?: never })?.kind as never))) {
    throw new ContentPackError(NEWER);
  }
  const parsed = contentPackSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new ContentPackError(`invalid pack: ${i.path.join('.') || 'pack'}: ${i.message}`);
  }
  return parsed.data;
}

export function summarizeContentPack(pack: ContentPack): { kind: string; label: string; count: number }[] {
  return pack.steps.map((s) => {
    switch (s.kind) {
      case 'code-system':
      case 'value-set': {
        const r = s.resource as { name?: string; url: string };
        return { kind: s.kind, label: r.name ?? r.url, count: 1 };
      }
      case 'facility-register':
        return { kind: s.kind, label: s.name, count: s.csv.split(/\r?\n/).slice(1).filter((l) => l.trim() !== '').length };
      case 'link-matching':
        return { kind: s.kind, label: s.registerUrl, count: 1 };
      case 'custom-queries':
        return { kind: s.kind, label: s.file.queries.map((q) => q.name).join(', '), count: s.file.queries.length };
    }
  });
}
```

  Manifest: add `const contentPackPayload = z.object({ kind: z.literal('content-pack'), packSha256: z.string().regex(HEX64), steps: z.array(z.object({ kind: z.string().min(1), label: z.string(), count: z.number().int().nonnegative() })) });`, add it to the discriminated union, add `'content-pack'` to the `type` enum. `bundle-fs.ts` and `pack.ts`: `'content-pack': 'pack.json'` and `'content-pack': 'packSha256'`. `index-json.ts`: add `'content-pack'`. Export the new names from `index.ts`.
- [ ] **Step 4:** run the Step 2 command and `pnpm --filter @openldr/marketplace exec vitest run` and `pnpm --filter @openldr/marketplace exec tsc --noEmit`, each redirected, `exit=0`.
- [ ] **Step 5: Commit** `feat(marketplace): a content-pack artifact type`.

### Task 2: db: install status (migration 108)

**Files:**
- Create: `packages/db/src/migrations/internal/108_marketplace_install_status.ts`, `108_marketplace_install_status.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts:7` (pinned internal list), `packages/db/src/schema/internal.ts:682-693`, `packages/db/src/marketplace-install-store.ts`, `packages/bootstrap/src/form-artifact-install.ts` (`list()` filters `kind === 'form-template'`), and its test.

**Interfaces:**
- Produces: `MarketplaceInstallRow` gains `status: 'installed' | 'failed'`, `failedStep: number | null`, `error: string | null`; `targetFormId: string | null`. `MarketplaceInstallInput` gains optional `status`, `failedStep`, `error`; `targetFormId?: string | null`. `upsert` writes and updates all of them (defaults `installed`, `null`, `null`).

- [ ] **Step 1: Failing tests.** Migration test (copy `107_lab_order_drop_specimen.test.ts`'s shape): after 108, insert a row with `target_form_id` NULL and read `status = 'installed'`; a row from before keeps `installed`. Store test: upsert `{ status: 'failed', failedStep: 4, error: 'x', targetFormId: null }` reads back the same; a second upsert with defaults resets to `installed`, `null`, `null`. Form installer test: `list()` skips a row with `kind: 'content-pack'`.
- [ ] **Step 2:** run them, expect failure.
- [ ] **Step 3: Implement.**

```ts
import { type Kysely, sql } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('marketplace_installs').alterColumn('target_form_id', (c) => c.dropNotNull()).execute();
  await db.schema.alterTable('marketplace_installs')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('installed'))
    .addColumn('failed_step', 'integer')
    .addColumn('error', 'text')
    .execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('marketplace_installs').dropColumn('error').dropColumn('failed_step').dropColumn('status').execute();
  await sql`delete from marketplace_installs where target_form_id is null`.execute(db);
  await db.schema.alterTable('marketplace_installs').alterColumn('target_form_id', (c) => c.setNotNull()).execute();
}
```

  Register `108_marketplace_install_status` after `107_lab_order_drop_specimen`. Update the schema type and the store's `toRow`, `upsert` insert values and `doUpdateSet`. In `form-artifact-install.ts` `list()`, keep only rows with `kind === 'form-template'`, and `drift()` returns `{ drifted: false }` when `targetFormId` is null. Add `'108_marketplace_install_status'` to the pinned list.
- [ ] **Step 4:** run `pnpm --filter @openldr/db exec vitest run src/migrations src/marketplace-install-store` and `pnpm --filter @openldr/bootstrap exec vitest run src/form-artifact-install`, plus both packages' `tsc --noEmit`, redirected, `exit=0`. If pg-mem cannot `drop not null`, say so in the report and test the column change on the real dev Postgres in Task 10 instead.
- [ ] **Step 5: Commit** `feat(db): record the status of a marketplace install`.

### Task 3: bootstrap: the two shared step helpers

**Files:**
- Modify: `packages/bootstrap/src/custom-query-transfer.ts` (extract the validation loop), its test
- Create: `packages/bootstrap/src/facility-register-file.ts`, `packages/bootstrap/src/facility-register-file.test.ts`

**Interfaces:**
- Produces:
  - `checkCustomQueryFile(file: unknown): void` (throws `CustomQueryTransferError`; the same checks `importCustomQueries` runs before writing). `importCustomQueries` calls it.
  - `importFacilityRegisterCsv(deps: FacilityRegisterFileDeps, input: { url: string; name: string; code: string; csv: string; apply: boolean; actor: { id: string | null; name: string } }): Promise<{ ok: true; result: FacilityImportResult } | { ok: false; error: string }>` where `FacilityRegisterFileDeps = { db: Kysely<InternalSchema>; capture: typeof referenceCapture; admin: TerminologyAdmin; facilityJobs?: FacilityJobs; audit: Audit; logger: Logger }` (the same object `packages/cli/src/facilities.ts:376` builds).

- [ ] **Step 1: Failing tests.**
  - `checkCustomQueryFile`: a file with a non-SELECT query throws `query "<name>": ...`; a valid file returns.
  - `importFacilityRegisterCsv` on pg-mem (copy the setup of the existing `importFacilities` tests in `packages/bootstrap/src/facility-import*.test.ts`), with a made-up 3-row CSV and URL `urn:test:labs`:
    - `apply: false` creates nothing and returns the preview;
    - `apply: true` creates the register source when absent, imports 3 rows, writes a `facility.import` audit event and an import run finished `applied`;
    - a second `apply: true` with the same URL reuses the source and leaves 3 rows;
    - a second apply with one row removed reports it absent and retires nothing (`written.retired === 0`);
    - a CSV with an unknown column returns `{ ok: false, error: 'unrecognised column(s): ...' }` and writes nothing.
- [ ] **Step 2:** run, expect failure.
- [ ] **Step 3: Implement.** `checkCustomQueryFile`: move the loop at `custom-query-transfer.ts:77-95` into it; `importCustomQueries` calls it then continues. `importFacilityRegisterCsv`:
  1. `const sources = createFacilityRegisterSourceStore(deps.db)`; `existing = await sources.getByUrl(input.url)`; when `!existing` and `input.apply`, `await sources.create({ url: input.url, name: input.name, code: input.code })`. When `!existing` and not apply, skip `resolveFacilityRegisterForImport` and run the preview only.
  2. When apply: `resolveFacilityRegisterForImport(sources, input.url)`; on `!ok` return `{ ok: false, error }`. Start an import run (`createFacilityImportRunStore(deps.db).startPreview`) with the same fields the CLI passes at `facilities.ts:347-362`, `requestedBy: input.actor.name`.
  3. `importOptions = { nationalSystem: input.url, onAbsent: 'report', runId }`; preview with `apply: undefined`. Refuse on `unknownColumns.length > 0` or `blocked`, finishing the run `failed` with the same reasons the CLI writes (`facilities.ts:425-449`), and return `{ ok: false, error }`.
  4. When apply: `importFacilities(deps, csv, { ...importOptions, apply: true })`, record `facility.import` (entity `input.url`, metadata `{ source: 'content-pack', result }`), finish the run `applied`.
  This duplicates about 40 lines of the CLI's orchestration on purpose: refactoring `runFacilitiesImport` (column maps, value maps, xlsx, JSONL) is out of scope. Say so in a comment that names `packages/cli/src/facilities.ts:246`.
- [ ] **Step 4:** run `pnpm --filter @openldr/bootstrap exec vitest run src/custom-query-transfer src/facility-register-file` and the bootstrap `tsc --noEmit`, redirected, `exit=0`.
- [ ] **Step 5: Commit** `feat(bootstrap): shared helpers for importing a register file and checking a query file`.

### Task 4: bootstrap: the content-pack installer

**Files:**
- Create: `packages/bootstrap/src/content-pack-install.ts`, `packages/bootstrap/src/content-pack-install.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (AppContext gains `marketplacePacks: ContentPackInstaller`, built next to `marketplaceForms` at line 694; export the factory and type)

**Interfaces:**
- Consumes: Task 1 `parseContentPack`, `summarizeContentPack`, `ContentPackError`; Task 2 store fields; Task 3 helpers; `linkMatchingFacilityCodes` (`packages/bootstrap/src/facility-link-matching.ts:37`); `ctx.loaders.resource`; `verifyBundle`, `keyFingerprint`, `evaluateTrust`, `createTrustStore` from `@openldr/marketplace`.
- Produces: `createContentPackInstaller(deps: ContentPackDeps)` returning `{ check(bundle): Promise<{ steps: { kind; label; count }[] }>, install(bundle, opts: { actor: { id?: string | null; name: string }; sourceRef?: string }): Promise<{ id; version; status: 'installed' | 'failed'; failedStep?: number; error?: string }>, detach(id, opts), list(): Promise<MarketplaceInstallRow[]> }` (`list` = rows with `kind === 'content-pack'`).

```ts
export interface ContentPackDeps {
  installStore: MarketplaceInstallStore;
  trustStore: TrustStore;
  audit: Audit;
  loadResource(json: unknown): Promise<{ resourceUrl: string }>;
  checkResource(json: unknown): void;            // throws when the resource would not load
  checkQueries(file: unknown): void;             // checkCustomQueryFile
  importQueries(file: unknown): Promise<unknown>; // importCustomQueries(..., { replace: true })
  register(input: { url: string; name: string; code: string; csv: string; apply: boolean; actor: { id: string | null; name: string } }):
    Promise<{ ok: true } | { ok: false; error: string }>;
  linkMatching(registerUrl: string, actor: { id: string | null; name: string }): Promise<{ ok: true } | { ok: false; error: string }>;
}
```

- [ ] **Step 1: Failing tests** with fake deps that log calls:
  - `check` on a valid bundle returns the summary and calls no write dep;
  - `install` calls, in file order: `loadResource`, `loadResource`, `register(apply true)`, `linkMatching`, `importQueries`; records `status: 'installed'` with `payloadSha256 = packSha256`, `targetFormId: null`, `kind: 'content-pack'`; writes one `marketplace.install` audit event with `metadata.type === 'content-pack'`;
  - a bad query (`checkQueries` throws) fails before any write dep is called, and nothing is recorded;
  - `register` preview returning `{ ok: false }` in pass 1 fails before any write;
  - `payload.packSha256` not matching the `pack.json` bytes throws `pack.json does not match the signed hash`;
  - `payload.steps` not equal to `summarizeContentPack(pack)` throws `step list does not match pack.json`;
  - an unknown step kind throws `this pack needs a newer CE` before any write;
  - `linkMatching` returning `{ ok: false, error: 'boom' }` records `status: 'failed'`, `failedStep: 4`, `error: 'boom'`, and the earlier steps stayed called; a second `install` with `linkMatching` fixed records `installed`;
  - a signed bundle from a pinned publisher with a different key throws `publisher key does not match the pinned key`; first use pins it;
  - `list` returns only `content-pack` rows.
- [ ] **Step 2:** run, expect failure.
- [ ] **Step 3: Implement.** Pass 1: signature check as `form-artifact-install.ts:32-38` (without the capability approval check: a pack has none), plus trust: `evaluateTrust(publisher.id, keyFingerprint(bundle.publicKeyDer), await trustStore.get(publisher.id))`, throw on `key-mismatch`. Then `sha256(bundle.wasm) === payload.packSha256`, `parseContentPack(JSON.parse(utf8(bundle.wasm)))`, compare `canonical JSON` of `payload.steps` with `summarizeContentPack`. Then per step: `checkResource`, `checkQueries`, `register({ ..., apply: false })`. `link-matching` needs no pass-1 check. Pass 2: pin trust on first use, then run steps in order inside a try; on the first error (thrown or `{ ok: false }`) upsert `status: 'failed'`, `failedStep: index + 1`, `error: message`, audit, and return that result. On success upsert `installed`. Number steps from 1.

  Wiring in `createAppContext` (`index.ts` near line 694):

```ts
const marketplacePacks = createContentPackInstaller({
  installStore: marketplaceInstalls,
  trustStore: createTrustStore(internal.db),
  audit,
  loadResource: (json) => terminology.loaders.resource(json),
  checkResource: (json) => { parseTerminologyResourceForImport(json); },
  checkQueries: checkCustomQueryFile,
  importQueries: (file) => importCustomQueries({ customQueries, connectors }, file, { replace: true }),
  register: (i) => importFacilityRegisterCsv(
    { db: internal.db, capture: referenceCapture, admin: terminology.admin, facilityJobs, audit, logger }, i),
  linkMatching: async (registerUrl) => {
    const out = await linkMatchingFacilityCodes({ internalDb: internal.db, externalDb: store.db as never, admin: terminology.admin }, { registerUrl, apply: true });
    if (!out.ok) return { ok: false, error: out.error };
    if (out.result.applied && out.result.counts.linked > 0) await facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: 'content-pack' });
    return { ok: true };
  },
});
```

  Use the real local names in `index.ts` for each dependency (check them; the names above are the intent). For `checkResource`, find the parse step inside `importTerminologyResource` and export it if it is not exported; if it cannot be split without touching loader behaviour, check `resourceType` and `url` only and say so in the report.
- [ ] **Step 4:** run `pnpm --filter @openldr/bootstrap exec vitest run src/content-pack-install` and the bootstrap `tsc --noEmit`, redirected, `exit=0`.
- [ ] **Step 5: Commit** `feat(bootstrap): install a content pack`.

### Task 5: server: install, list and detach packs

**Files:**
- Modify: `apps/server/src/marketplace-routes.ts` (install dispatch at :200, installed list at :66, detach at :368), `apps/server/src/marketplace-routes.test.ts` (or the file that tests these routes; find it)

**Interfaces:**
- Consumes: `ctx.marketplacePacks` (Task 4).
- Produces: `POST /api/marketplace/install` returns `{ id, version, status, failedStep?, error? }` for a pack (HTTP 200 even when `status: 'failed'`; the body says so). `GET /api/marketplace/installed` pack rows: `{ id, version, active: true, enabled: true, approvedBy, type: 'content-pack', publisher, description: null, license: null, payload: null, capabilities: [], legacy: false, status, failedStep, error }`. `POST /api/marketplace/:id/detach` detaches a pack or a form by the row's kind.

- [ ] **Step 1: Failing route tests** (copy the existing install route test setup): installing a `content-pack` bundle calls `marketplacePacks.install` and returns its result; a failed pack install returns 200 with `status: 'failed'`; the installed list carries a pack row with `status`; detach of a pack id calls `marketplacePacks.detach`; the detail of a registry pack (`GET /api/marketplace/available/:ref`) returns `payload.steps`.
- [ ] **Step 2:** run, expect failure.
- [ ] **Step 3: Implement** the dispatch (`if (b.manifest.type === 'content-pack') { return ctx.marketplacePacks.install(b, { actor: a, sourceRef: ref }); }` before the form branch), the list rows, and the detach dispatch (look the id up in `ctx.marketplacePacks.list()`; if found detach there, else the form installer). Every handler returns or awaits its `reply.send` per the server lint rule.
- [ ] **Step 4:** run the route test file, `pnpm --filter @openldr/server exec tsc --noEmit`, and `pnpm --filter @openldr/server lint`, redirected, `exit=0`.
- [ ] **Step 5: Commit** `feat(server): install, list and detach content packs`.

### Task 6: CLI: `market install` by type, `--dry-run`, `--force`; `artifact pack`

**Files:**
- Modify: `packages/cli/src/market.ts` (install, list), `packages/cli/src/program.ts:1036-1043`, `packages/cli/src/artifact.ts:35-39`, `packages/cli/src/market.test.ts`, `packages/cli/src/artifact.test.ts`

**Interfaces:**
- Consumes: `ctx.marketplacePacks`, `ctx.marketplaceForms` from `createAppContext`.
- Produces: `runMarketInstall(dir, opts: { json; approve?; approvedBy?; dryRun?; force? })`.

- [ ] **Step 1: Failing tests:** a `content-pack` bundle dir goes to the pack installer (not `ctx.plugins.install`); `--dry-run` calls `check` only and prints the step list; installing an already-installed pack without `--force` exits 1 with `already installed; use --force to install again`; a `form-template` bundle goes to the form installer; `market list` prints pack rows with their status; `artifact pack` on a dir with `manifest.json` (type `content-pack`) and `pack.json` writes a bundle whose manifest has `payload.packSha256`.
- [ ] **Step 2:** run, expect failure.
- [ ] **Step 3: Implement.** Read the bundle first; for `plugin` keep today's path (`createIngestContext`); for `content-pack` and `form-template` open `createAppContext(loadConfig())`, dispatch, close. Pack actor `{ id: null, name: 'cli' }`. Register `--dry-run` and `--force` on the command. `artifact.ts`: `'content-pack': 'pack.json'`. For a failed install print `failed at step N: <error>` and exit 1.
- [ ] **Step 4:** run `pnpm --filter @openldr/cli exec vitest run src/market.test.ts src/artifact.test.ts` and the cli `tsc --noEmit`, redirected, `exit=0`.
- [ ] **Step 5: Commit** `feat(cli): install content packs from the command line`.

### Task 7: studio: browse, install and manage packs

**Files:**
- Modify: `apps/studio/src/pages/settings/marketplace/MarketplaceTabs.tsx:100`, `PackageDetail.tsx` (:53, :71, installed `⋯` items at :140), `PayloadPreview.tsx`, `apps/studio/src/pages/settings/Marketplace.tsx` (confirm prompt at :140), `apps/studio/src/api.ts` (`ArtifactPayloadMeta` gains the content-pack variant; installed row gains `status`, `failedStep`, `error`), `apps/studio/src/i18n/{en,fr,pt}.ts`, and the tests `PackageDetail.test.tsx`, `Marketplace.test.tsx`, plus a new `PayloadPreview.test.tsx`

**Interfaces:**
- Consumes: Task 5 wire shapes.

- [ ] **Step 1: Failing tests** (named files only):
  - `PayloadPreview` with a `content-pack` payload lists one row per step: a localized step name and its count, plus the label;
  - `PackageDetail` for a registry pack shows "Install" enabled once detail loads;
  - an installed pack with `status: 'failed'` shows the failed step and error, and its `⋯` menu has "Install again" and "Detach"; "Install again" calls `onInstall` with the entry's ref;
  - the type filter offers "Content pack";
  - `Marketplace` install confirm for a pack lists its steps, not capabilities.
- [ ] **Step 2:** run `pnpm --filter @openldr/studio exec vitest run src/pages/settings/marketplace/PayloadPreview.test.tsx src/pages/settings/marketplace/PackageDetail.test.tsx src/pages/settings/Marketplace.test.tsx`, expect failure.
- [ ] **Step 3: Implement.** i18n keys under `settings.marketplace`: `typeContentPack`, `packSteps`, `packStep.code-system`, `packStep.value-set`, `packStep.facility-register`, `packStep.link-matching`, `packStep.custom-queries`, `packFailedAt` ("Failed at step {{step}}: {{error}}"), `installAgain`. Write all three languages in the same commit; a missing key renders as literal braces. Keep actions in the existing `⋯` menu.
- [ ] **Step 4:** run the Step 2 command and `pnpm --filter @openldr/studio exec tsc --noEmit`, redirected, `exit=0`. Then mobile: controller live check in Task 10.
- [ ] **Step 5: Commit** `feat(studio): browse, install and manage content packs`.

### Task 8: docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/marketplace.md`, `apps/web/src/docs/0.1.8/marketplace-permissions.md`, `apps/web/src/docs/0.1.8/cli.md`

- [ ] **Step 1.** Add a "Content packs" section to each studio file, in each file's own vocabulary: what a pack is (code systems, value sets, a facility register, link-matching, queries, installed in that order); checks first, writes nothing if a check fails; installing twice is safe; a failed install keeps the earlier steps and is finished by installing again; rows dropped from a newer pack's register are reported, not retired; detach forgets the record and keeps the content; no uninstall. Web `marketplace-permissions.md`: packs need the same manage permission and declare no capabilities. Web `cli.md`: `openldr market install <dir> [--dry-run] [--force]`. No em dashes.
- [ ] **Step 2.** `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run src/docs`, redirected, `exit=0`.
- [ ] **Step 3: Commit** `docs: content packs`.

### Task 9: cdr-toolchain: the `vl-reports-mz` pack source

**Files (cdr worktree):**
- Create: `packs/vl-reports-mz/build.mjs`, `packs/vl-reports-mz/vl-queries.mjs`, `packs/vl-reports-mz/README.md`, `packs/vl-reports-mz/.gitignore` (`dist/`)
- Source to move from: `D:/Projects/Repositories/openldr_ce/packs/disa/` (`build.mjs`, `vl-queries.mjs`, `README.md`; outside git, copy them)

- [ ] **Step 1.** Copy the three files. Apply the renames from Global Constraints everywhere (URNs, register code, query names, folder name, README title). Keep `IsDisaPoc`/`IsDisaLink` column names.
- [ ] **Step 2.** Change `build.mjs` to write `dist/pack.json` (steps in this order: poc CodeSystem, poc ValueSet, link CodeSystem, link ValueSet, facility-register with the CSV, link-matching, custom-queries with the query export file) and `dist/manifest.json`:

```json
{ "schemaVersion": 1, "type": "content-pack", "id": "vl-reports-mz", "version": "0.1.0",
  "description": "Viral load reports in the v1 layout, for data exported from DISA*Lab.",
  "readme": "<README text plus the build summary of rows left out>", "license": "UNLICENSED",
  "publisher": { "id": "openldr-content", "name": "OpenLDR Content Publisher", "keyFingerprint": "<filled by artifact pack>" },
  "compatibility": { "ceVersion": "*" }, "capabilities": [],
  "payload": { "kind": "content-pack", "steps": [ ] } }
```

  `payload.steps` is computed with the same rules as `summarizeContentPack` (Task 1). Write a small inline copy in `build.mjs` and a comment pointing at `packages/marketplace/src/content-pack.ts` in CE. Check how `openldr artifact pack` fills `publisher.keyFingerprint` (`packages/marketplace/src/pack.ts`) and leave whatever field it expects.
- [ ] **Step 3.** Run `node packs/vl-reports-mz/build.mjs` (it reads the v1 dictionary, SELECT only). Check `dist/pack.json` parses, has 7 steps, the register has 311 rows, and no `disa` appears in any URN or query name (`grep -i "urn:openldr:disa\|DISA VL" dist/pack.json` returns nothing).
- [ ] **Step 4.** README: building, the step order, signing with `openldr artifact pack <dist> --key <publisher key>`, publishing with `openldr artifact publish`, and that the private key never enters a repo.
- [ ] **Step 5: Commit** (cdr) `feat(packs): the vl-reports-mz content pack source`. Never commit `dist/`.

### Task 10: gates, publish, live install (controller)

- [ ] **Step 1: CE gates.** `pnpm turbo run test --force --concurrency=4` and `pnpm turbo run typecheck --force`, redirected, `exit=0`. `pnpm --filter @openldr/server lint`, `exit=0`.
- [ ] **Step 2: Key (ask first).** Make the "OpenLDR Content Publisher" key with `openldr artifact keygen --out <path outside every repo>`. The operator decides where the private key lives.
- [ ] **Step 3: Build and sign.** `node packs/vl-reports-mz/build.mjs` in cdr, then `openldr artifact pack <dist> --key <key>` and `openldr market verify <bundle>`.
- [ ] **Step 4 (ask first): merge and live install.** Merge CE to local `main`, start the dev API so 108 runs, publish the bundle into a local copy of the marketplace (`openldr artifact publish --to <local marketplace>/bundles`), point a registry at it, and install from Settings, Marketplace. Then: both queries run; installing again changes nothing and duplicates nothing; `openldr market install --dry-run` prints 7 steps; mobile check at 375x812 of the detail, the confirm prompt and the Installed tab. `pnpm make:changelog`.
- [ ] **Step 5 (ask first): clean the dev CE.** Remove the old `urn:openldr:disa:*` value sets and register and the two "DISA VL" queries from the dev CE. Delete `openldr_ce/packs/disa/` and update `openldr_ce/packs/README.md` to point at cdr-toolchain.
- [ ] **Step 6 (ask first): publish.** Commit the bundle and `index.json` entry to the marketplace repo; push the three repos only when asked.
