// Builds the trivial test-sink plugin to wasm and stages plugin.wasm + manifest.json under
// reference-plugins/test-sink/. Pure Rust (no C deps) so it needs only the wasm32-wasip1
// target — no clang/WASI sysroot, unlike the whonet-sqlite build.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');

const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', 'test_sink.wasm');
const workspaceToml = readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8');
const ver = (workspaceToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

/** Builds test-sink with the given cargo features and copies it to reference-plugins/<name>/. */
function buildInto(name, features) {
  const flag = features ? ` --features ${features}` : '';
  execSync(`cargo build -p test-sink --release --target wasm32-wasip1${flag}`, { cwd: wasmDir, stdio: 'inherit', env: process.env });
  const dir = join(root, 'reference-plugins', name);
  mkdirSync(dir, { recursive: true });
  const staged = join(dir, 'plugin.wasm');
  copyFileSync(built, staged);
  return { dir, staged, sha: createHash('sha256').update(readFileSync(staged)).digest('hex') };
}

// The host build goes first, so the plain build is the last one left in target/.
const hostBuild = buildInto('test-sink-host', 'host');
// test-sink-host: the same crate with the host-function entrypoints. Its module imports db_select,
// db_write, ce_read and fhir_emit, so it is a plugin of its own: the plain test-sink below must
// still load where no host functions are given. Written as an artifact manifest, the form install
// takes, because declared tables live in payload.tables.
const hostManifest = {
  schemaVersion: 1,
  type: 'plugin',
  id: 'test-sink-host',
  version: ver,
  description: 'Test plugin that calls the CE host functions',
  license: 'Apache-2.0',
  compatibility: { ceVersion: '*' },
  capabilities: [
    { kind: 'host:db' },
    { kind: 'host:ce-read' },
    { kind: 'emit-fhir', resourceTypes: ['Observation'] },
  ],
  payload: {
    kind: 'plugin',
    pluginKind: 'sink',
    wasmSha256: hostBuild.sha,
    entrypoints: ['health_check', 'host_db_select', 'host_db_write', 'host_db_roundtrip', 'host_ce_read', 'host_fhir_emit'],
    wasi: true,
    limits: { memoryMb: 256, timeoutMs: 30000 },
    // A facility table: CE limits every read and write to the caller's facilities.
    tables: [{
      name: 'samples',
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'facility', type: 'uuid' },
        { name: 'code', type: 'text' },
        { name: 'note', type: 'text', nullable: true },
      ],
      primaryKey: ['id'],
      indexes: [{ columns: ['facility', 'code'] }],
      facilityColumn: 'facility',
    }],
    // Plugin host 2b: the plugin's own permission, in its own group `sinkhost`, and the permission
    // each action needs (any one of the list). host_db_roundtrip is left out on purpose, so the
    // broker refuses it (closed by default). host_fhir_emit needs a CE capability, which the plugin
    // only asks of callers and never gets for itself.
    permissions: [{
      key: 'sinkhost.run',
      label: 'Run the test sink',
      description: 'Run the actions of the test sink plugin.',
      labels: {
        fr: { label: 'Lancer le plugin de test', description: 'Lancer les actions du plugin de test.' },
        pt: { label: 'Executar o plugin de teste', description: 'Executar as ações do plugin de teste.' },
      },
    }],
    actionPermissions: {
      health_check: ['sinkhost.run'],
      host_db_select: ['sinkhost.run'],
      host_db_write: ['sinkhost.run'],
      host_ce_read: ['sinkhost.run', 'patients.find'],
      host_fhir_emit: ['forms.edit'],
    },
  },
};
writeFileSync(join(hostBuild.dir, 'manifest.json'), JSON.stringify(hostManifest, null, 2) + '\n');
process.stdout.write(`staged ${hostBuild.staged} (sha256 ${hostBuild.sha}) + manifest.json\n`);

const { dir, staged, sha } = buildInto('test-sink', '');

const manifest = {
  id: 'test-sink',
  version: ver,
  kind: 'sink',
  entrypoints: ['health_check', 'push_aggregate', 'wf_echo', 'wf_convert', 'wf_emit'],
  wasmSha256: sha,
  description: 'Trivial sink ABI test plugin',
  license: 'Apache-2.0',
  // wasm32-wasip1's std imports wasi_snapshot_preview1 even for in-memory plugins.
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
  // Declares net-egress intent (empty allowedHosts = host pins the concrete host at runtime).
  capabilities: [{ kind: 'net-egress', allowedHosts: [] }],
  // SP-1/SP-2: contribute a workflow-builder transform node backed by the wf_echo entrypoint.
  workflowNodes: [
    {
      id: 'echo', label: 'Echo', kind: 'transform', entrypoint: 'wf_echo',
      ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
      config: [{ key: 'note', label: 'Note', type: 'text' }],
    },
    {
      id: 'convert', label: 'Convert Lines', kind: 'transform', entrypoint: 'wf_convert',
      abi: 'bytes', binaryField: 'file',
      ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
      config: [],
    },
    {
      id: 'emit', label: 'Emit File', kind: 'transform', entrypoint: 'wf_emit',
      ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [], config: [],
    },
  ],
};
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
