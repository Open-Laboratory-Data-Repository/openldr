// Builds the reference plugins that live in this repository (hl7v2, tabular) to wasm and stages
// plugin.wasm + manifest.json under reference-plugins/<id>/. whonet-sqlite moved to its own
// repository on 2026-11-18; the seeds fetch its signed bundle from the marketplace
// (scripts/fetch-marketplace-bundle.mjs).
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');
// Version comes from the workspace package version in wasm/Cargo.toml.
const workspaceToml = readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8');
const ver = (workspaceToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

function buildPure(crate, id, description, capabilities, workflowNodes) {
  execSync(`cargo build -p ${crate} --release --target wasm32-wasip1`, { cwd: wasmDir, stdio: 'inherit', env: process.env });
  const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', `${crate.replace(/-/g, '_')}.wasm`);
  const dir = join(root, 'reference-plugins', id);
  mkdirSync(dir, { recursive: true });
  const staged = join(dir, 'plugin.wasm');
  copyFileSync(built, staged);
  const sha = createHash('sha256').update(readFileSync(staged)).digest('hex');
  // wasm32-wasip1's std imports wasi_snapshot_preview1 (clock/random/fd) even for in-memory
  // plugins, so the sandbox must enable WASI (isolation stays default-deny fs/net).
  // capabilities must match what the plugin emits — emit-fhir is enforced fail-closed.
  const manifest = { id, version: ver, entrypoint: 'convert', wasmSha256: sha, description, license: 'Apache-2.0', wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 }, capabilities,
    ...(workflowNodes ? { entrypoints: ['wf_convert'], workflowNodes } : {}) };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
}
buildPure('hl7v2', 'hl7v2', 'HL7 v2 (ORU/ORM) -> FHIR R4 ingestion plugin', [
  { kind: 'read-input', formats: ['hl7v2'] },
  { kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation', 'DiagnosticReport', 'ServiceRequest'] },
], [
  {
    id: 'convert', label: 'HL7v2 → items', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file',
    capabilities: [], ports: { inputs: [{ name: 'file' }], outputs: [{ name: 'out' }] },
    config: [
      { key: 'output', label: 'Output', type: 'select', required: true, default: 'fhir',
        options: [{ value: 'fhir', label: 'FHIR resources' }, { value: 'rows', label: 'Parsed rows' }] },
      { key: 'organismIdCodes', label: 'Organism ID codes', type: 'json', required: false },
      { key: 'astInterpretationCodes', label: 'AST interpretation codes', type: 'json', required: false },
    ],
  },
]);
buildPure('tabular', 'tabular', 'CSV/Excel -> FHIR R4 ingestion plugin (configurable mapping)', [
  { kind: 'read-input', formats: ['csv', 'xlsx'] },
  { kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation'] },
], [
  {
    id: 'convert', label: 'CSV/Excel → items', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file',
    capabilities: [], ports: { inputs: [{ name: 'file' }], outputs: [{ name: 'out' }] },
    config: [
      { key: 'output', label: 'Output', type: 'select', required: true, default: 'fhir',
        options: [{ value: 'fhir', label: 'FHIR resources' }, { value: 'rows', label: 'Parsed rows' }] },
      { key: 'mapping', label: 'Column mapping', type: 'json', required: false },
      { key: 'sheet', label: 'Sheet (Excel)', type: 'text', required: false },
    ],
  },
]);
