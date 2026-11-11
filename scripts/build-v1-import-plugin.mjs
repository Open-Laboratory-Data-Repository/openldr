// Builds the OpenLDR v1 import plugin to wasm and stages plugin.wasm + manifest.json under
// reference-plugins/openldr-v1-import/ (both git-ignored build output).
//
// Needs the Rust wasm32-wasip1 target (wasm/rust-toolchain.toml asks rustup for it). Unlike the
// WHONET plugin, this crate has no C code, so no clang or WASI sysroot is needed.
//
// Install the staged plugin with:
//   pnpm openldr plugin install reference-plugins/openldr-v1-import/plugin.wasm
// The manifest has no publisher, so it installs unsigned. A release bundle for the marketplace is
// packed and signed separately (`openldr artifact pack`).
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');
const id = 'openldr-v1-import';
const outDir = join(root, 'reference-plugins', id);

execSync(`cargo build -p ${id} --release --target wasm32-wasip1`, { cwd: wasmDir, stdio: 'inherit', env: process.env });

const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', `${id.replace(/-/g, '_')}.wasm`);
mkdirSync(outDir, { recursive: true });
const staged = join(outDir, 'plugin.wasm');
copyFileSync(built, staged);
const sha = createHash('sha256').update(readFileSync(staged)).digest('hex');
// Version comes from the workspace package version in wasm/Cargo.toml.
const ver = (readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8').match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

const ENTRYPOINTS = ['import_queries', 'import_checks', 'import_map'];
// A full artifact manifest, not the flat legacy shape: `importSource` only exists on the
// artifact payload, and the import service reads it from there.
const manifest = {
  schemaVersion: 1,
  type: 'plugin',
  id,
  version: ver,
  description: 'Imports requests, patients, results and AST results from an OpenLDR v1 SQL Server database.',
  license: 'Apache-2.0',
  compatibility: { ceVersion: '*' },
  capabilities: [
    // Read the database connectors an admin allows for this plugin, and save what it maps.
    { kind: 'host:import' },
    // Enforced when saving: the plugin may write these resource types and no others.
    { kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Organization', 'ServiceRequest', 'DiagnosticReport', 'Observation'] },
  ],
  payload: {
    kind: 'plugin',
    pluginKind: 'sink',
    wasmSha256: sha,
    entrypoints: ENTRYPOINTS,
    // wasm32-wasip1's std imports wasi_snapshot_preview1 even for an in-memory plugin, so the
    // sandbox must enable WASI. Filesystem and network stay denied.
    wasi: true,
    // A page of 500 requests with their results is a few MB of JSON each way.
    limits: { memoryMb: 512, timeoutMs: 30000 },
    importSource: {
      connectorTypes: ['microsoft-sql'],
      sourceSystem: 'openldr-v1',
      entrypoints: { queries: 'import_queries', checks: 'import_checks', map: 'import_map' },
    },
  },
};
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
