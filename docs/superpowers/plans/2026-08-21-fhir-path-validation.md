# FHIR path validation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FormField.fhirPath` checkable, so a wrong path is caught by a test or a lint rule instead of surviving until a FHIR export reads it.

**Architecture:** A build-time script walks `@types/fhir`'s `r4.d.ts` with the TypeScript compiler API and emits a checked-in path table. `packages/fhir` exposes it under a `./paths` subpath export. `packages/forms` gets a `resolveFhirPath` helper that turns a bare path into a canonical resource-prefixed one. Phase 2 builds lint rules on top of that table; Phase 3 builds the builder UI on top of the same table.

**Tech Stack:** TypeScript 5.7, `typescript` compiler API, `@types/fhir` 0.0.44, zod 3, vitest 2, tsx, pnpm workspaces, turbo.

**Spec:** `docs/superpowers/specs/2026-08-21-fhir-path-validation-design.md`

## Global Constraints

- Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer. Commit messages carry no agent attribution.
- Commit messages follow conventional commits. `feat`, `fix`, `perf` reach the public changelog; `chore`, `docs`, `test` do not.
- No em dashes anywhere, in code comments, docs, or commit messages. No emoji in headings or bullets.
- Run the full gate with `pnpm turbo run test`. Never pipe turbo through `tail`; it truncates the failure list. A gate failure is usually a timeout, not a regression. Grep for `Test timed out` and rerun that package alone before blaming a change.
- `apps/server` is the only package with real lint.
- Do not hardcode clinical vocabulary. This plan touches FHIR structure only, never codes, organisms, statuses, or value sets.
- Kysely enforces strict numeric migration order. Phase 1 adds no migration. Phase 2 does, and 089 is the next free number as of 2026-08-21, confirmed unclaimed on `main`, `feat/no-update-found`, `feat/update-verdict`, and `origin/feat/transmission-grid-clinical-bucketing`.
- Work merges to local `main` first, then syncs to origin. Confirm the origin SHA after pushing. Do not open a PR unless asked.

## Facts this plan is built on

Each was verified in the working tree on 2026-08-21, not assumed.

- The zod schemas in `packages/fhir/src/resources/` are deliberately partial and end in `.passthrough()`. `ServiceRequest` stops at `specimen` (`packages/fhir/src/resources/service-request.ts:21`) and has no `locationCode`, `note`, or `performer`, all three of which the shipped Requisition sample binds. They cannot be the path authority.
- `@types/fhir@0.0.44` has no `exports` map, so deep file resolution works.
- A prototype walker over `r4.d.ts` at depth 3 across nine resource types produced 1596 rows, and every one of the 25 paths used by the four shipped sample forms resolved. Zero false positives.
- Payload size, measured: 487 KB with full JSDoc, 146 KB with the JSDoc first line only, 78 KB with no docs. This plan ships the 146 KB variant, because the first line is the text that carries "District name (aka county)", which is the entire point of the table.
- `Practitioner` is the `fhirResourceType` of a shipped sample (`packages/forms/src/samples/forms.ts:143`) but is absent from `registerResource`. The allowlist must not be derived from the registry alone.
- `normalizeFormSchema` runs only in the studio builder (`apps/studio/src/forms-builder/FormBuilderPage.tsx:47`, `CompareDialog.tsx:45`). It is not on the server read path, in the form runtime, or in extraction.

---

## File structure

Phase 1 creates or modifies these, and nothing else.

| File | Responsibility |
|---|---|
| `packages/fhir/src/paths/build-table.ts` | Pure walker. Source text in, rows out. The only file importing `typescript`. |
| `packages/fhir/src/paths/build-table.test.ts` | Walker unit tests against an inline fixture `.d.ts`. |
| `packages/fhir/src/paths/generate.ts` | Generator config and rendering. Imports the walker. Never imported by `index.ts`. |
| `packages/fhir/src/paths/r4-paths.generated.ts` | The emitted table. Never hand-edited. |
| `packages/fhir/src/paths/index.ts` | Lookup API over the table. Imports neither the compiler nor `generate.ts`. |
| `packages/fhir/src/paths/index.test.ts` | Lookup tests and the staleness test. |
| `packages/fhir/package.json` | Adds the `./paths` subpath export and a devDependency. |
| `scripts/gen-fhir-paths.ts` | Thin CLI. Calls `generate.ts` and writes the file. |
| `package.json` | Adds the `gen:fhir-paths` script. |
| `packages/forms/src/fhir-path.ts` | `resolveFhirPath`. |
| `packages/forms/src/fhir-path.test.ts` | Its tests. |
| `packages/forms/src/index.ts`, `pure.ts` | Re-export `resolveFhirPath`. |
| `packages/forms/src/normalize.ts` | Upgrades bare paths on load. |

The walker is split from the generator so it can be tested without touching the filesystem or the real 35,000-line `.d.ts`. The lookup API is split from the walker so consumers never pull the compiler into their bundle.

---

# Phase 1: path table and grammar

No lint rules. No visible change. Nothing can break, because nothing reads the table yet.

---

### Task 1: The path walker

**Files:**
- Create: `packages/fhir/src/paths/build-table.ts`
- Test: `packages/fhir/src/paths/build-table.test.ts`
- Modify: `packages/fhir/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface FhirPathRow { path: string; leafType: string; isArray: boolean; label: string }`
  - `export interface BuildTableOptions { roots: readonly string[]; maxDepth?: number; stopTypes?: readonly string[] }`
  - `export function buildPathTable(sourceText: string, options: BuildTableOptions): FhirPathRow[]`
  - Rows are sorted by `path` ascending, so output is deterministic.

`leafType` is the TypeScript type name of the leaf: `'string'`, `'number'`, `'boolean'`, `'code'` for a union of string literals, or a FHIR datatype name such as `'CodeableConcept'`, `'Identifier'`, `'Reference'`.

`isArray` is true when **any** segment along the path is an array, not only the leaf. `Location.identifier.value` is `isArray: true` because `Location.identifier` is `Identifier[]`. Phase 2's cardinality rule depends on exactly this meaning.

`maxDepth` counts segments **after** the root. `Location.address.district` is depth 2. `Location.address.period.start` is depth 3. Default 3.

- [ ] **Step 1: Add the type definitions as a devDependency**

The walker reads `@types/fhir`'s `r4.d.ts` as data. `typescript` is already a devDependency of this package.

```bash
pnpm --filter @openldr/fhir add -D @types/fhir@^0.0.44
```

Confirm `packages/fhir/package.json` now lists `@types/fhir` alongside `typescript` under `devDependencies`. It stays a devDependency, not a dependency: only the generator reads it, and the shipped lookup API imports nothing from it.

`@types/node` is deliberately not added. `packages/fhir/tsconfig.json` extends the base config, and TypeScript walks up to the root `node_modules/@types`, where `@types/node` already sits as a root devDependency. `packages/forms/src/store.ts:1` imports `node:crypto` today on exactly that basis.

- [ ] **Step 2: Write the failing test**

Create `packages/fhir/src/paths/build-table.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPathTable, type FhirPathRow } from './build-table';

// A miniature .d.ts in the exact shape @types/fhir emits: optional members typed
// `X | undefined`, string-literal unions wrapped in parentheses, `_x` siblings carrying
// primitive extensions, and a `readonly resourceType` discriminator.
const FIXTURE = `
export interface Element {
  /** Unique id for inter-element referencing */
  id?: string | undefined;
}
export interface Period extends Element {
  /** Starting time with inclusive boundary */
  start?: string | undefined;
}
export interface Reference extends Element {
  /** Literal reference, Relative, internal or absolute URL */
  reference?: string | undefined;
}
export interface Identifier extends Element {
  /**
   * usual | official | temp | secondary | old
   * The purpose of this identifier.
   */
  use?: ('usual'|'official'|'temp'|'secondary'|'old') | undefined;
  _use?: Element | undefined;
  /** The value that is unique */
  value?: string | undefined;
  /** Organization that issued id */
  assigner?: Reference | undefined;
}
export interface Widget {
  /** Resource Type Name (for serialization) */
  readonly resourceType: 'Widget';
  /** Business identifier */
  identifier?: Identifier[] | undefined;
  /**
   * Name of the widget
   * The human readable name, which does not need to be unique.
   */
  name?: string | undefined;
  _name?: Element | undefined;
  /** When it was valid */
  period?: Period | undefined;
}
`;

function build(maxDepth = 3): FhirPathRow[] {
  return buildPathTable(FIXTURE, { roots: ['Widget'], maxDepth, stopTypes: ['Reference'] });
}

function at(rows: FhirPathRow[], path: string): FhirPathRow | undefined {
  return rows.find((r) => r.path === path);
}

describe('buildPathTable', () => {
  it('emits a primitive leaf with the JSDoc first line as its label', () => {
    expect(at(build(), 'Widget.name')).toEqual({
      path: 'Widget.name',
      leafType: 'string',
      isArray: false,
      label: 'Name of the widget',
    });
  });

  it('marks a path as an array when ANY segment on the way is an array', () => {
    // Widget.identifier is Identifier[], so the string leaf below it is still array-reached.
    expect(at(build(), 'Widget.identifier.value')).toMatchObject({ leafType: 'string', isArray: true });
    expect(at(build(), 'Widget.period.start')).toMatchObject({ leafType: 'string', isArray: false });
  });

  it('skips the _x primitive-extension siblings', () => {
    expect(build().some((r) => r.path.split('.').some((seg) => seg.startsWith('_')))).toBe(false);
  });

  it('skips the resourceType discriminator', () => {
    expect(at(build(), 'Widget.resourceType')).toBeUndefined();
  });

  it('flattens a string-literal union to the code type', () => {
    expect(at(build(), 'Widget.identifier.use')).toMatchObject({ leafType: 'code', isArray: true });
  });

  it('emits a stop type but does not recurse into it', () => {
    expect(at(build(), 'Widget.identifier.assigner')).toMatchObject({ leafType: 'Reference' });
    expect(at(build(), 'Widget.identifier.assigner.reference')).toBeUndefined();
  });

  it('follows the extends chain for inherited members', () => {
    // Period declares only `start`; `id` is inherited from Element.
    expect(at(build(), 'Widget.period.id')).toMatchObject({ leafType: 'string' });
  });

  it('honours maxDepth, counting segments after the root', () => {
    const shallow = build(1).map((r) => r.path);
    expect(shallow).toEqual(['Widget.identifier', 'Widget.name', 'Widget.period']);
  });

  it('returns rows sorted by path so output is deterministic', () => {
    const paths = build().map((r) => r.path);
    expect(paths).toEqual([...paths].sort());
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @openldr/fhir test -- build-table
```

Expected: FAIL, `Failed to resolve import "./build-table"`.

- [ ] **Step 4: Write the implementation**

Create `packages/fhir/src/paths/build-table.ts`:

```ts
import ts from 'typescript';

/** One bindable path on a FHIR resource. */
export interface FhirPathRow {
  /** Resource-prefixed dotted path, for example `Location.address.district`. */
  path: string;
  /**
   * TypeScript type name of the leaf: `string`, `number`, `boolean`, `code` for a union of
   * string literals, or a FHIR datatype name such as `CodeableConcept`.
   */
  leafType: string;
  /**
   * True when ANY segment along the path is an array, not only the leaf.
   * `Location.identifier.value` is true because `Location.identifier` is `Identifier[]`.
   * The cardinality lint rule depends on this exact meaning.
   */
  isArray: boolean;
  /** First line of the member's JSDoc, which in `@types/fhir` is the element's short label. */
  label: string;
}

export interface BuildTableOptions {
  /** Resource interface names to walk from. */
  roots: readonly string[];
  /** Segments after the root. `Location.address.district` is depth 2. Defaults to 3. */
  maxDepth?: number;
  /** Type names to emit but never recurse into. */
  stopTypes?: readonly string[];
}

interface Leaf {
  type: string;
  isArray: boolean;
  isEnum: boolean;
}

/**
 * Reduce a member's type node to its leaf.
 *
 * `@types/fhir` writes every optional member as `X | undefined`, arrays as `X[]`, and coded
 * elements as a parenthesised union of string literals. Returns null for anything else, which
 * is skipped rather than guessed at.
 */
function unwrap(node: ts.TypeNode): Leaf | null {
  if (ts.isUnionTypeNode(node)) {
    const parts = node.types.filter((p) => p.kind !== ts.SyntaxKind.UndefinedKeyword);
    if (parts.length === 1) return unwrap(parts[0]!);
    if (parts.length > 1 && parts.every((p) => ts.isLiteralTypeNode(p))) {
      return { type: 'code', isArray: false, isEnum: true };
    }
    return null;
  }
  if (ts.isParenthesizedTypeNode(node)) return unwrap(node.type);
  if (ts.isArrayTypeNode(node)) {
    const inner = unwrap(node.elementType);
    return inner ? { ...inner, isArray: true } : null;
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    return { type: node.typeName.text, isArray: false, isEnum: false };
  }
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword: return { type: 'string', isArray: false, isEnum: false };
    case ts.SyntaxKind.NumberKeyword: return { type: 'number', isArray: false, isEnum: false };
    case ts.SyntaxKind.BooleanKeyword: return { type: 'boolean', isArray: false, isEnum: false };
    default: return null;
  }
}

/** First line of a member's JSDoc. Empty string when it has none. */
function firstDocLine(node: ts.Node): string {
  const docs = (node as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc;
  const comment = docs?.[0]?.comment;
  if (typeof comment !== 'string') return '';
  for (const line of comment.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

export function buildPathTable(sourceText: string, options: BuildTableOptions): FhirPathRow[] {
  const maxDepth = options.maxDepth ?? 3;
  const stopTypes = new Set(options.stopTypes ?? []);

  // `setParentNodes: true` is what attaches the `jsDoc` array the label reader above needs.
  const source = ts.createSourceFile('r4.d.ts', sourceText, ts.ScriptTarget.Latest, true);

  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
  });

  /** Every property signature of an interface, inherited members first. */
  function membersOf(name: string, seen = new Set<string>()): ts.PropertySignature[] {
    if (seen.has(name)) return [];
    seen.add(name);
    const iface = interfaces.get(name);
    if (!iface) return [];
    const inherited: ts.PropertySignature[] = [];
    for (const clause of iface.heritageClauses ?? []) {
      for (const type of clause.types) {
        if (ts.isIdentifier(type.expression)) inherited.push(...membersOf(type.expression.text, seen));
      }
    }
    return [...inherited, ...iface.members.filter(ts.isPropertySignature)];
  }

  const rows: FhirPathRow[] = [];

  function walk(typeName: string, prefix: string, depth: number, arraySeen: boolean, branch: Set<string>): void {
    if (depth > maxDepth) return;
    for (const member of membersOf(typeName)) {
      if (!ts.isIdentifier(member.name) || !member.type) continue;
      const key = member.name.text;
      // `_use`, `_name` and friends carry primitive extensions, never a bindable value.
      if (key.startsWith('_')) continue;
      if (key === 'resourceType') continue;

      const leaf = unwrap(member.type);
      if (!leaf) continue;

      const path = `${prefix}.${key}`;
      const isArray = arraySeen || leaf.isArray;
      rows.push({ path, leafType: leaf.type, isArray, label: firstDocLine(member) });

      if (leaf.isEnum) continue;
      if (stopTypes.has(leaf.type)) continue;
      if (!interfaces.has(leaf.type)) continue;   // a primitive, nothing to recurse into
      if (branch.has(leaf.type)) continue;        // self-referential datatype, stop the cycle
      walk(leaf.type, path, depth + 1, isArray, new Set([...branch, leaf.type]));
    }
  }

  for (const root of options.roots) {
    if (!interfaces.has(root)) throw new Error(`buildPathTable: unknown root interface "${root}"`);
    walk(root, root, 1, false, new Set([root]));
  }

  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return rows;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @openldr/fhir test -- build-table
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @openldr/fhir typecheck
```

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/fhir/src/paths/build-table.ts packages/fhir/src/paths/build-table.test.ts packages/fhir/package.json pnpm-lock.yaml
git commit -m "feat(fhir): walk the R4 type definitions into a bindable path table"
```

---

### Task 2: The generator script and the emitted table

**Files:**
- Create: `packages/fhir/src/paths/generate.ts`
- Create: `scripts/gen-fhir-paths.ts`
- Create: `packages/fhir/src/paths/r4-paths.generated.ts` (written by the script, then committed)
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: `buildPathTable`, `FhirPathRow` from Task 1.
- Produces, from `packages/fhir/src/paths/generate.ts`:
  - `export const ROOT_RESOURCE_TYPES: readonly string[]`
  - `export const STOP_TYPES: readonly string[]`
  - `export const MAX_DEPTH: number`
  - `export function resolveR4Dts(): string`
  - `export function renderTable(rows: FhirPathRow[]): string`
  - `export function generateTableSource(): { source: string; count: number }`
- Produces, from `packages/fhir/src/paths/r4-paths.generated.ts`:
  - `export type R4PathTuple = readonly [path: string, leafType: string, isArray: 0 | 1, label: string]`
  - `export const R4_PATHS: readonly R4PathTuple[]`
  - `export const R4_PATH_RESOURCE_TYPES: readonly string[]`

The generator config lives inside `packages/fhir` rather than in `scripts/`, so Task 3's staleness test can import it as a sibling. A test reaching up into `scripts/` would sit outside the package's `rootDir` and break `tsc --noEmit`.

The tuple encoding is deliberate. Measured on the real input: objects with full JSDoc are 487 KB, tuples with the JSDoc first line are 146 KB. The first line is the payload that matters, so tuples plus first line is the shipped shape.

- [ ] **Step 1: Write the generator module**

Create `packages/fhir/src/paths/generate.ts`:

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildPathTable, type FhirPathRow } from './build-table';

/**
 * Resource types a form field can bind to.
 *
 * NOT derived from `registerResource` in packages/fhir/src/resources. That registry exists to
 * validate what CE writes, and it both misses `Practitioner` (which a shipped sample form
 * targets, see packages/forms/src/samples/forms.ts:143) and includes infrastructure resources
 * such as Bundle, ValueSet, and ConceptMap that no form field ever binds to. Extending this list
 * is a one-line change followed by `pnpm gen:fhir-paths`.
 */
export const ROOT_RESOURCE_TYPES = [
  'DiagnosticReport',
  'Encounter',
  'Location',
  'Observation',
  'Organization',
  'Patient',
  'Practitioner',
  'ServiceRequest',
  'Specimen',
] as const;

/**
 * Emitted as paths, never recursed into.
 *
 * A `Reference` is a pointer, so its internals are not a binding target. `Extension` and
 * `Narrative` are structural noise. `Resource` and `Meta` would drag every resource's envelope
 * into every path.
 */
export const STOP_TYPES = ['Reference', 'Extension', 'Narrative', 'Resource', 'Meta'] as const;

/** Segments after the root. Covers Location.address.period.start, which is as deep as forms go. */
export const MAX_DEPTH = 3;

/**
 * Locate r4.d.ts.
 *
 * `@types/fhir` publishes no `exports` map, so a deep resolve works. Resolving `package.json`
 * rather than `r4.d.ts` directly, because the package sets `"main": ""` and a bare specifier
 * resolve is not worth relying on.
 */
export function resolveR4Dts(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@types/fhir/package.json')), 'r4.d.ts');
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function renderTable(rows: FhirPathRow[]): string {
  const roots = [...new Set(rows.map((r) => r.path.slice(0, r.path.indexOf('.'))))].sort();
  const lines = rows.map(
    (r) => `  [${quote(r.path)}, ${quote(r.leafType)}, ${r.isArray ? 1 : 0}, ${quote(r.label)}],`,
  );
  return `// GENERATED FILE. Do not edit by hand.
// Regenerate with: pnpm gen:fhir-paths
//
// Source: @types/fhir r4.d.ts. Each row is one bindable path on a FHIR R4 resource.
// Tuples rather than objects, and the JSDoc first line rather than the full comment, because
// the object-with-full-docs encoding measures 487 KB against this one's 146 KB.

/** [path, leafType, isArray, label]. isArray is 1 when ANY segment on the path is an array. */
export type R4PathTuple = readonly [path: string, leafType: string, isArray: 0 | 1, label: string];

export const R4_PATH_RESOURCE_TYPES: readonly string[] = ${JSON.stringify(roots)};

export const R4_PATHS: readonly R4PathTuple[] = [
${lines.join('\n')}
];
`;
}

/** Read the type definitions and render the table. The single source of truth for both the CLI and the staleness test. */
export function generateTableSource(): { source: string; count: number } {
  const rows = buildPathTable(readFileSync(resolveR4Dts(), 'utf8'), {
    roots: ROOT_RESOURCE_TYPES,
    maxDepth: MAX_DEPTH,
    stopTypes: STOP_TYPES,
  });
  return { source: renderTable(rows), count: rows.length };
}
```

- [ ] **Step 2: Write the CLI**

Create `scripts/gen-fhir-paths.ts`. The relative import into package source mirrors `scripts/make-changelog.ts:14`, and the `repoRoot` derivation mirrors `scripts/make-changelog.ts:16`.

```ts
// Generates packages/fhir/src/paths/r4-paths.generated.ts from @types/fhir's r4.d.ts.
//
// The output is committed. Nothing regenerates it at build time, and a stale file fails the
// staleness test in packages/fhir/src/paths/index.test.ts.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTableSource } from '../packages/fhir/src/paths/generate';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(repoRoot, 'packages/fhir/src/paths/r4-paths.generated.ts');

const { source, count } = generateTableSource();
writeFileSync(OUT, source, 'utf8');
console.log(`wrote ${count} paths to ${OUT}`);
```

- [ ] **Step 3: Add the root script**

In the root `package.json`, add to `scripts`, next to the other `make:` entries:

```json
"gen:fhir-paths": "tsx scripts/gen-fhir-paths.ts"
```

No root dependency is needed. `@types/fhir` is resolved from `packages/fhir/src/paths/generate.ts`, where Task 1 added it.

- [ ] **Step 4: Run the generator**

```bash
pnpm gen:fhir-paths
```

Expected: `wrote 1596 paths to packages/fhir/src/paths/r4-paths.generated.ts`.

If the count differs, do not adjust the expectation. Check `ROOT_RESOURCE_TYPES`, `MAX_DEPTH`, and `STOP_TYPES` against the values above first, because 1596 is a measured number from exactly those settings.

- [ ] **Step 5: Verify the table by hand**

```bash
grep -c '^  \[' packages/fhir/src/paths/r4-paths.generated.ts
grep '"Location.address.district"' packages/fhir/src/paths/r4-paths.generated.ts
grep '"Location.identifier.value"' packages/fhir/src/paths/r4-paths.generated.ts
grep '"ServiceRequest.locationCode"' packages/fhir/src/paths/r4-paths.generated.ts
```

Expected, in order:
- `1596`
- `["Location.address.district", "string", 0, "District name (aka county)"],`
- `["Location.identifier.value", "string", 1, "The value that is unique"],`
- `["ServiceRequest.locationCode", "CodeableConcept", 1, "Requested location"],`

The `1` on `Location.identifier.value` is the signal Phase 2's cardinality rule fires on. The `"District name (aka county)"` string is what Phase 3 renders under the input.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @openldr/fhir typecheck
```

Expected: no output, exit 0. A 1596-entry literal is well inside what `tsc` handles, but this confirms it.

- [ ] **Step 7: Commit**

```bash
git add packages/fhir/src/paths/generate.ts scripts/gen-fhir-paths.ts packages/fhir/src/paths/r4-paths.generated.ts package.json
git commit -m "feat(fhir): generate the R4 path table from the published type definitions"
```

---

### Task 3: The lookup API and the staleness test

**Files:**
- Create: `packages/fhir/src/paths/index.ts`
- Test: `packages/fhir/src/paths/index.test.ts`
- Modify: `packages/fhir/package.json`

**Interfaces:**
- Consumes: `R4_PATHS`, `R4_PATH_RESOURCE_TYPES`, `R4PathTuple` from the generated file, and `generateTableSource` from `./generate`, both Task 2.
- Produces:
  - `export interface FhirPathInfo { path: string; resourceType: string; leafType: string; isArray: boolean; label: string }`
  - `export function lookupFhirPath(path: string): FhirPathInfo | null`
  - `export function fhirPathsFor(resourceType: string): FhirPathInfo[]`
  - `export function isKnownFhirResourceType(resourceType: string): boolean`
  - `export const FHIR_PATH_RESOURCE_TYPES: readonly string[]`
  - Importable as `@openldr/fhir/paths`.

This module must not import `typescript` or `build-table`. Phase 3 bundles it into the studio.

- [ ] **Step 1: Add the subpath export**

In `packages/fhir/package.json`, change `exports` from:

```json
"exports": { ".": "./src/index.ts" },
```

to:

```json
"exports": {
  ".": "./src/index.ts",
  "./paths": "./src/paths/index.ts"
},
```

This mirrors the `@openldr/forms/pure` precedent. The table stays out of the main entry so a consumer that only wants the zod schemas does not pull 146 KB.

- [ ] **Step 2: Write the failing test**

Create `packages/fhir/src/paths/index.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateTableSource } from './generate';
import {
  FHIR_PATH_RESOURCE_TYPES,
  fhirPathsFor,
  isKnownFhirResourceType,
  lookupFhirPath,
} from './index';

describe('lookupFhirPath', () => {
  it('resolves an administrative address element with its official label', () => {
    expect(lookupFhirPath('Location.address.district')).toEqual({
      path: 'Location.address.district',
      resourceType: 'Location',
      leafType: 'string',
      isArray: false,
      label: 'District name (aka county)',
    });
  });

  it('reports a path reached through an array as isArray, even when the leaf is a scalar', () => {
    // Location.identifier is Identifier[]. This is the signal the cardinality rule fires on.
    expect(lookupFhirPath('Location.identifier.value')).toMatchObject({ leafType: 'string', isArray: true });
  });

  it('carries the leaf datatype for coded elements', () => {
    expect(lookupFhirPath('Location.physicalType')).toMatchObject({ leafType: 'CodeableConcept' });
    expect(lookupFhirPath('Location.status')).toMatchObject({ leafType: 'code' });
  });

  it('returns null for a path that does not exist', () => {
    expect(lookupFhirPath('Location.address.zone')).toBeNull();
    expect(lookupFhirPath('Widget.name')).toBeNull();
    expect(lookupFhirPath('')).toBeNull();
  });

  // Every path bound by every shipped sample form. This is the list that proves the table has
  // no false negatives against real data. See packages/forms/src/samples/forms.ts.
  it.each([
    'Location.identifier.value', 'Location.name', 'Location.address.country',
    'Location.address.district', 'Location.address.state', 'Location.address.city',
    'Location.status', 'Location.physicalType',
    'Practitioner.name.given', 'Practitioner.name.family', 'Practitioner.telecom.value',
    'Patient.name.given', 'Patient.name.family', 'Patient.birthDate', 'Patient.gender',
    'Patient.telecom.value',
    'ServiceRequest.subject', 'ServiceRequest.code', 'ServiceRequest.priority',
    'ServiceRequest.locationCode', 'ServiceRequest.requester', 'ServiceRequest.identifier',
    'ServiceRequest.note', 'ServiceRequest.performer',
    'Specimen.type',
  ])('resolves the shipped sample path %s', (path) => {
    expect(lookupFhirPath(path)).not.toBeNull();
  });
});

describe('fhirPathsFor', () => {
  it('returns only that resource type, and a non-trivial number of them', () => {
    const rows = fhirPathsFor('Location');
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.every((r) => r.resourceType === 'Location')).toBe(true);
    expect(rows.map((r) => r.path)).toContain('Location.address.district');
  });

  it('returns an empty array for an unknown resource type', () => {
    expect(fhirPathsFor('Widget')).toEqual([]);
  });
});

describe('isKnownFhirResourceType', () => {
  it('accepts Practitioner, which is a shipped sample target but is absent from registerResource', () => {
    expect(isKnownFhirResourceType('Practitioner')).toBe(true);
  });

  it('rejects infrastructure resources no form binds to', () => {
    expect(isKnownFhirResourceType('Bundle')).toBe(false);
  });

  it('exposes the full list', () => {
    expect(FHIR_PATH_RESOURCE_TYPES).toContain('Location');
    expect([...FHIR_PATH_RESOURCE_TYPES]).toEqual([...FHIR_PATH_RESOURCE_TYPES].sort());
  });
});

describe('the generated table', () => {
  it('is not stale', () => {
    const { source: expected } = generateTableSource();
    // Resolved from this test file, not from cwd. Vitest's cwd is the package directory under
    // `pnpm --filter` but the repo root under `turbo run test`, so a relative path is not stable.
    const generatedFile = fileURLToPath(new URL('./r4-paths.generated.ts', import.meta.url));
    const actual = readFileSync(generatedFile, 'utf8');
    // Normalise line endings: git checks this file out with CRLF on Windows.
    expect(actual.replace(/\r\n/g, '\n')).toBe(expected.replace(/\r\n/g, '\n'));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @openldr/fhir test -- paths/index
```

Expected: FAIL, `Failed to resolve import "./index"`.

- [ ] **Step 4: Write the implementation**

Create `packages/fhir/src/paths/index.ts`:

```ts
import { R4_PATHS, R4_PATH_RESOURCE_TYPES, type R4PathTuple } from './r4-paths.generated';

export type { R4PathTuple };

/** One bindable path, decoded from the generated tuple table. */
export interface FhirPathInfo {
  /** Resource-prefixed dotted path, for example `Location.address.district`. */
  path: string;
  /** The leading segment, for example `Location`. */
  resourceType: string;
  /** `string`, `number`, `boolean`, `code`, or a FHIR datatype name such as `CodeableConcept`. */
  leafType: string;
  /**
   * True when ANY segment along the path is an array. `Location.identifier.value` is true
   * because `Location.identifier` is `Identifier[]`, even though `value` itself is a scalar.
   */
  isArray: boolean;
  /** The element's short label, straight from the R4 definition. */
  label: string;
}

/** Resource types the table covers, sorted. */
export const FHIR_PATH_RESOURCE_TYPES: readonly string[] = R4_PATH_RESOURCE_TYPES;

const RESOURCE_TYPE_SET = new Set(R4_PATH_RESOURCE_TYPES);

function decode(tuple: R4PathTuple): FhirPathInfo {
  const [path, leafType, isArray, label] = tuple;
  return { path, resourceType: path.slice(0, path.indexOf('.')), leafType, isArray: isArray === 1, label };
}

// Built once on first use rather than at module load, so importing this module for
// `isKnownFhirResourceType` alone does not pay for indexing 1596 rows.
let index: Map<string, FhirPathInfo> | null = null;

function getIndex(): Map<string, FhirPathInfo> {
  if (!index) {
    index = new Map();
    for (const tuple of R4_PATHS) {
      const info = decode(tuple);
      index.set(info.path, info);
    }
  }
  return index;
}

/** The path's definition, or null when the table does not contain it. */
export function lookupFhirPath(path: string): FhirPathInfo | null {
  if (!path) return null;
  return getIndex().get(path) ?? null;
}

/** Every path on one resource type, in table order. Empty when the type is not covered. */
export function fhirPathsFor(resourceType: string): FhirPathInfo[] {
  if (!RESOURCE_TYPE_SET.has(resourceType)) return [];
  const prefix = `${resourceType}.`;
  const out: FhirPathInfo[] = [];
  for (const info of getIndex().values()) {
    if (info.path.startsWith(prefix)) out.push(info);
  }
  return out;
}

/** Whether the table covers this resource type at all. */
export function isKnownFhirResourceType(resourceType: string): boolean {
  return RESOURCE_TYPE_SET.has(resourceType);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @openldr/fhir test -- paths/index
```

Expected: PASS. The 25 `it.each` sample-path cases must all pass. If any fails, the allowlist or depth in `scripts/gen-fhir-paths.ts` is wrong, not the test.

- [ ] **Step 6: Run the whole package and typecheck**

```bash
pnpm --filter @openldr/fhir test
pnpm --filter @openldr/fhir typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/fhir/src/paths/index.ts packages/fhir/src/paths/index.test.ts packages/fhir/package.json
git commit -m "feat(fhir): look up an R4 path definition by its dotted path"
```

---

### Task 4: resolveFhirPath

**Files:**
- Create: `packages/forms/src/fhir-path.ts`
- Test: `packages/forms/src/fhir-path.test.ts`
- Modify: `packages/forms/src/index.ts`, `packages/forms/src/pure.ts`

**Interfaces:**
- Consumes: `isKnownFhirResourceType` from `@openldr/fhir/paths` (Task 3).
- Produces: `export function resolveFhirPath(fhirPath: string | null | undefined, fhirResourceType: string | null | undefined): string | null`

The spec writes this as `resolveFhirPath(field, schema)`. Primitives are the implementation, because the linter, the builder, and the future export writer each hold those two values in a different shape and none of them should have to construct a `FormField` to ask the question.

Rules, in order:
1. Falsy `fhirPath` returns null.
2. A path whose leading segment is a known resource type is already canonical, returned unchanged.
3. Otherwise, when `fhirResourceType` is a known resource type, prepend it.
4. Otherwise return null. Phase 2 reports that as its own lint finding rather than guessing.

- [ ] **Step 1: Check the workspace dependency**

`packages/forms/package.json` already lists `"@openldr/fhir": "workspace:*"` under `dependencies`. Confirm it, and add it if absent:

```bash
grep '"@openldr/fhir"' packages/forms/package.json
```

- [ ] **Step 2: Write the failing test**

Create `packages/forms/src/fhir-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveFhirPath } from './fhir-path';

describe('resolveFhirPath', () => {
  it('prefixes a bare path with the form resource type', () => {
    expect(resolveFhirPath('address.district', 'Location')).toBe('Location.address.district');
    expect(resolveFhirPath('name', 'Location')).toBe('Location.name');
  });

  it('leaves an already prefixed path untouched', () => {
    expect(resolveFhirPath('ServiceRequest.code', 'ServiceRequest')).toBe('ServiceRequest.code');
  });

  it('leaves a path prefixed with a DIFFERENT resource type untouched', () => {
    // The shipped Requisition form declares fhirResourceType ServiceRequest and binds
    // Specimen.type. Multi-resource extraction is exactly why the prefix exists.
    expect(resolveFhirPath('Specimen.type', 'ServiceRequest')).toBe('Specimen.type');
  });

  it('returns null for an empty or missing path', () => {
    expect(resolveFhirPath(null, 'Location')).toBeNull();
    expect(resolveFhirPath(undefined, 'Location')).toBeNull();
    expect(resolveFhirPath('', 'Location')).toBeNull();
  });

  it('returns null for a bare path when the form declares no resource type', () => {
    expect(resolveFhirPath('address.district', null)).toBeNull();
    expect(resolveFhirPath('address.district', '')).toBeNull();
  });

  it('returns null for a bare path when the resource type is not covered by the table', () => {
    // Bundle is a real FHIR resource but not a form binding target, so nothing can be resolved
    // against it. Guessing a prefix here would manufacture a path the table cannot check.
    expect(resolveFhirPath('entry.resource', 'Bundle')).toBeNull();
  });

  it('does not mistake a single-segment path for a resource prefix', () => {
    expect(resolveFhirPath('status', 'Location')).toBe('Location.status');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @openldr/forms test -- fhir-path
```

Expected: FAIL, `Failed to resolve import "./fhir-path"`.

- [ ] **Step 4: Write the implementation**

Create `packages/forms/src/fhir-path.ts`:

```ts
import { isKnownFhirResourceType } from '@openldr/fhir/paths';

/**
 * Turn a form field's `fhirPath` into its canonical, resource-prefixed form.
 *
 * Two grammars are in the wild. The Facility and Practitioner samples write bare paths
 * (`address.district`); the Patient and Requisition samples write prefixed ones
 * (`Patient.birthDate`). Prefixed is canonical, because a form can bind fields on more than one
 * resource: the Requisition form declares `fhirResourceType: 'ServiceRequest'` and carries
 * `Specimen.type` fields (packages/forms/src/samples/forms.ts:428). A bare path cannot say which
 * resource a field lands on.
 *
 * Returns null rather than guessing when a bare path has no resource type to hang off. The
 * caller reports that; this function never invents a prefix.
 */
export function resolveFhirPath(
  fhirPath: string | null | undefined,
  fhirResourceType: string | null | undefined,
): string | null {
  if (!fhirPath) return null;

  const head = fhirPath.slice(0, fhirPath.indexOf('.') === -1 ? fhirPath.length : fhirPath.indexOf('.'));
  if (isKnownFhirResourceType(head)) return fhirPath;

  if (!fhirResourceType) return null;
  if (!isKnownFhirResourceType(fhirResourceType)) return null;
  return `${fhirResourceType}.${fhirPath}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @openldr/forms test -- fhir-path
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Re-export**

Both files use `export * from './x'` throughout. Add this line to `packages/forms/src/pure.ts`, next to the existing `export * from './lint';`:

```ts
export * from './fhir-path';
```

Add the identical line to `packages/forms/src/index.ts`.

`fhir-path.ts` imports only from `@openldr/fhir/paths`, which pulls no Node built-ins, so it is safe in `pure.ts` and will not drag `node:crypto` or the database into the web bundle. That is what `pure.ts`'s own header comment requires.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm --filter @openldr/forms typecheck
```

Expected: no output, exit 0.

```bash
git add packages/forms/src/fhir-path.ts packages/forms/src/fhir-path.test.ts packages/forms/src/index.ts packages/forms/src/pure.ts
git commit -m "feat(forms): resolve a bare fhirPath to its canonical resource-prefixed form"
```

---

### Task 5: Persist canonical paths from the builder

**Files:**
- Modify: `packages/forms/src/normalize.ts`
- Test: `packages/forms/src/normalize.test.ts`

**Interfaces:**
- Consumes: `resolveFhirPath` from Task 4.
- Produces: no new exports. `normalizeFormSchema` now emits canonical `fhirPath` values.

This is convenience, not the mechanism. `normalizeFormSchema` runs only in the studio builder (`apps/studio/src/forms-builder/FormBuilderPage.tsx:47` and `CompareDialog.tsx:45`), so it upgrades a form the next time someone opens and saves it. Every consumer that must be correct calls `resolveFhirPath` directly.

A bare path that cannot be resolved is left exactly as it was. Blanking it would destroy an operator's work over a resource type the table happens not to cover.

- [ ] **Step 1: Write the failing test**

Append to `packages/forms/src/normalize.test.ts`:

```ts
describe('normalizeFormSchema fhirPath canonicalisation', () => {
  it('prefixes a bare path with the form resource type', () => {
    const result = normalizeFormSchema({
      id: 'f1',
      name: 'Facility',
      fhirResourceType: 'Location',
      fields: [{ id: 'fld-zone', fhirPath: 'address.district', displayLabel: 'Zone', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('Location.address.district');
  });

  it('leaves an already prefixed path untouched', () => {
    const result = normalizeFormSchema({
      id: 'f2',
      name: 'Requisition',
      fhirResourceType: 'ServiceRequest',
      fields: [{ id: 'fld-spec', fhirPath: 'Specimen.type', displayLabel: 'Specimen', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('Specimen.type');
  });

  it('leaves a bare path alone when it cannot be resolved, rather than blanking it', () => {
    const result = normalizeFormSchema({
      id: 'f3',
      name: 'Untyped',
      fhirResourceType: null,
      fields: [{ id: 'fld-x', fhirPath: 'address.district', displayLabel: 'X', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('address.district');
  });

  it('leaves a null path null', () => {
    const result = normalizeFormSchema({
      id: 'f4',
      name: 'Facility',
      fhirResourceType: 'Location',
      fields: [{ id: 'fld-council', fhirPath: null, displayLabel: 'Council', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBeNull();
  });
});
```

If `normalize.test.ts` does not already import `describe`, `expect`, `it` from `vitest` and `normalizeFormSchema` from `./normalize`, add those imports.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/forms test -- normalize
```

Expected: FAIL on the first case, received `'address.district'`, expected `'Location.address.district'`.

- [ ] **Step 3: Thread the resource type into normalizeField**

In `packages/forms/src/normalize.ts`:

Add the import at the top:

```ts
import { resolveFhirPath } from './fhir-path';
```

Read the resource type before the fields are mapped, and pass it down. Change:

```ts
  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  const fields = rawFields.map((f, idx) => normalizeField(f, idx));
```

to:

```ts
  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  const resourceType = stringValue(source.fhirResourceType) ?? null;
  const fields = rawFields.map((f, idx) => normalizeField(f, idx, resourceType));
```

- [ ] **Step 4: Canonicalise inside normalizeField**

Change the signature of `normalizeField` from:

```ts
function normalizeField(input: unknown, idx: number): FormField {
```

to:

```ts
function normalizeField(input: unknown, idx: number, resourceType: string | null = null): FormField {
```

and change the `fhirPath` line from:

```ts
  const fhirPath = source.fhirPath !== undefined ? source.fhirPath : null;
```

to:

```ts
  const rawPath = source.fhirPath !== undefined ? source.fhirPath : null;
  // Canonicalise to the resource-prefixed grammar. An unresolvable bare path is kept as
  // written: blanking it would throw away an operator's mapping over a resource type the
  // generated table happens not to cover.
  const fhirPath = typeof rawPath === 'string' ? (resolveFhirPath(rawPath, resourceType) ?? rawPath) : rawPath;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @openldr/forms test -- normalize
```

Expected: PASS.

- [ ] **Step 6: Run the whole forms package**

```bash
pnpm --filter @openldr/forms test
```

Expected: all pass. Pay attention to `round-trip.test.ts` and `diff.test.ts`, which compare normalized output against fixtures. If a fixture form carries a bare path and a `fhirResourceType`, its expected value now gains a prefix. Update the fixture expectation, not the implementation, and only after confirming the new value is the correct canonical path.

- [ ] **Step 7: Commit**

```bash
git add packages/forms/src/normalize.ts packages/forms/src/normalize.test.ts
git commit -m "feat(forms): persist canonical resource-prefixed fhirPath values from the builder"
```

---

### Task 6: Gate and changelog

**Files:**
- Modify: `apps/web/src/landing/changelog.json`

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test
```

Expected: every package passes. Do not pipe this through `tail`; it truncates the failure list and hides which package failed.

If something fails, grep the output for `Test timed out` first. A timeout is not a regression from this work. Rerun that package alone before investigating:

```bash
pnpm --filter <package> test
```

- [ ] **Step 2: Typecheck the workspace**

```bash
pnpm turbo run typecheck
```

Expected: clean. `apps/studio` and `apps/server` both resolve `@openldr/forms`, so this is what proves the `pure.ts` and `index.ts` re-exports did not break a consumer.

- [ ] **Step 3: Verify the generator is reproducible**

```bash
pnpm gen:fhir-paths
git diff --stat packages/fhir/src/paths/r4-paths.generated.ts
```

Expected: no diff. If there is one, the generator is not deterministic and the staleness test in Task 3 will fail intermittently in CI. Fix the nondeterminism before continuing; the usual cause is an unsorted collection.

- [ ] **Step 4: Merge to local main**

Phase 1 adds no migration, so there is no numbering hazard and no boot check needed.

- [ ] **Step 5: Regenerate the changelog**

Run this after merging to `main`, never before. The generator reads git history and cannot see commits that are not there yet.

```bash
pnpm make:changelog
```

- [ ] **Step 6: Commit the changelog**

```bash
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```

---

## Phase 1 definition of done

Per `AGENTS.md` §6. Four of the five rows are legitimately empty, because Phase 1 has no user-facing surface.

| | Status |
|---|---|
| UI | Not applicable. No operator-visible change. |
| CLI parity | Not applicable. No operator-facing command. Arrives in Phase 2 as `openldr forms lint`. |
| Docs, en/fr/pt | Not applicable. No user-visible strings. |
| Mobile view | Not applicable. No UI. |
| Landing changelog | Task 6, steps 5 and 6. |

## What Phase 1 proves, and what it does not

- Proven: the table contains every path the four shipped sample forms bind, with correct array flags and leaf types. That is the `it.each` block in Task 3.
- Proven: the generated file matches a fresh run of the generator.
- Proven: `resolveFhirPath` upgrades bare paths and leaves prefixed ones alone.
- **Not proven:** that any wrong path is rejected anywhere. Phase 1 ships no lint rule. `Location.address.district` on a field labelled Zone still saves and publishes exactly as it does today.
- **Not proven:** that a real FHIR consumer accepts anything CE emits. Nothing exports a `Location` yet.

---

# Phase 2 outline: rules and the correction

Not yet expanded into tasks. The rule implementations depend on the shape of the table Phase 1 actually produces, and on the leaf-type vocabulary it turns out to use.

**Deliverable:** wrong paths are rejected, and every shipped form passes.

**Scope:**

1. Four lint rules in `packages/forms/src/lint.ts`, all severity `error`, all calling `resolveFhirPath` then `lookupFhirPath`.
   - `unknown-fhir-path`. Not in the table for its resource type. Also fires when `resolveFhirPath` returns null for a non-null path, which means the form has no usable `fhirResourceType`.
   - `fhir-path-cardinality`. `isArray` is true, and the path carries neither a numeric segment nor a `fhirDiscriminator`. Complements the existing `ambiguous-fhir-path` rule rather than replacing it.
   - `fhir-path-type-mismatch`. The leaf datatype cannot hold the declared `fieldType`. Needs a deliberate compatibility table, and the `reference` field type binding a `CodeableConcept` is a legitimate pairing that must not fire.
   - `facility-admin-order`. Keyed on `apiProperty` against `FACILITY_ADMIN_LEVELS` from `@openldr/db`, never on the display label.
2. The corrected mapping in `packages/forms/src/samples/forms.ts`, per the spec's table.
3. Migration 089 for installed forms, following the 071, 072, 073 pattern exactly: a frozen prior snapshot, an exact-match guard so an operator's own edits survive, and a marker key so `down()` is a precise inverse.
4. `FACILITY_FORM_MIGRATION_BOUND_FIELDS` moved to the new snapshot, which is what `packages/forms/src/samples/forms.test.ts` pins against.
5. `openldr forms lint` in `packages/cli/src/forms.ts`, alongside the existing `runFormsExtract` and `runFormsList`, calling the same `lintFormSchema`.
6. Docs for the new lint codes, in en, fr, and pt. A missing key renders as literal braces, so a partial translation ships visibly broken.

**Ordering constraint:** rules and the data correction ship in one merge. Rules first would gate publish on the seeded form, because lint errors drive `canPublish` (`apps/studio/src/forms-builder/FormBuilderPage.tsx:240`). The correction first would leave a window with nothing defending it.

**Migration hazard:** 089 must be verified on a real boot. pg-mem cannot catch a numbering gap. Recheck that 089 is still unclaimed at the time Phase 2 starts, because an unmerged branch may have taken it since.

---

# Phase 3 outline: builder UI

Not yet expanded into tasks. Purely additive; Phase 2's rules already hold the line, so this can slip without correctness cost.

**Deliverable:** an operator cannot easily type a wrong path in the first place.

**Scope:**

1. Replace the free-text FHIR Path `<Input>` in `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx:47` with a searchable combobox over `fhirPathsFor(schema.fhirResourceType)`.
2. Render the selected element's `label` under the input in muted text. For `Location.address.district` that reads "District name (aka county)", which is the string that makes the semantic class visible to a human.
3. Keep free text as an escape hatch, so a gap in the generated table never blocks an operator. The lint rule reports it instead.
4. Fix the misleading placeholder. It currently reads `e.g. Patient.name` while the surrounding data is bare.
5. shadcn only, per `AGENTS.md` §5. Label left, input right, `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`. No native `<select>`.

**Known trap, from the mobile pass:** a portalled `PopoverContent` inside a Sheet cannot scroll, because `react-remove-scroll` only permits the Sheet's own subtree. The FHIR Path input lives inside `FieldEditorSheet`, and the combobox list will be long. Wrap rather than scrolling sideways inside the dialog, and verify at 375x812.

**Bundle note:** the table measures 146 KB. It is reachable only from the forms-builder route. Check whether the studio's build splits that route before deciding whether a dynamic import is warranted.
