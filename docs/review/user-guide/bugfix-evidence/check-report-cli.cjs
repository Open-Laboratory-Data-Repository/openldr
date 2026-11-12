// Supply the private isolated environment before running this script.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../../../..');
for (const [key, database] of [['INTERNAL_DATABASE_URL', 'guide_bugfix_internal'], ['TARGET_DATABASE_URL', 'guide_bugfix_target']]) {
  const url = new URL(process.env[key]);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '15439');
  assert.equal(url.pathname, '/' + database);
}
assert.equal(process.env.S3_BUCKET, 'openldr-docs-bugfix-review');
assert.equal(process.env.TARGET_STORE_ADAPTER, 'pg');
assert.equal(process.env.AUTH_DEV_BYPASS, 'true');
assert.equal(process.env.IDENTITY_ADMIN_ADAPTER, 'none');
const dates = ['--param', 'from=2026-01-01', '--param', 'to=2026-11-12'];
const results = {};
for (const format of ['json', 'csv', 'pdf']) {
  const args = ['packages/cli/dev.mjs', 'report', 'run', 'r-bugfix-date-range', ...dates];
  const outputPath = path.join(__dirname, 'date-range-cli.' + format);
  args.push(...(format === 'pdf' ? ['--format', 'pdf', '--out', outputPath] : ['--' + format]));
  const run = spawnSync(process.execPath, args, { cwd: repo, env: process.env, encoding: 'utf8' });
  assert.equal(run.status, 0, format + ' CLI failed');
  if (format === 'json') {
    const start = run.stdout.indexOf('{\n  "columns"');
    assert(start >= 0, 'Missing JSON report output');
    const result = JSON.parse(run.stdout.slice(start));
    assert.deepEqual(result.rows, [{ start_date: '2026-01-01', end_date: '2026-11-12' }]);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    results[format] = { exit: run.status, rowCount: result.rows.length, rows: result.rows };
  } else if (format === 'csv') {
    const start = run.stdout.indexOf('start_date,end_date');
    assert(start >= 0, 'Missing CSV header');
    const csv = run.stdout.slice(start);
    assert(csv.includes('2026-01-01,2026-11-12'));
    fs.writeFileSync(outputPath, csv);
    results[format] = { exit: run.status, bytes: Buffer.byteLength(csv) };
  } else {
    const bytes = fs.readFileSync(outputPath);
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    results[format] = { exit: run.status, bytes: bytes.length };
  }
}
(async () => {
  const { Pool } = require(path.join(repo, 'packages/db/node_modules/pg'));
  const pools = ['INTERNAL_DATABASE_URL', 'TARGET_DATABASE_URL'].map(key => new Pool({ connectionString: process.env[key] }));
  try {
    const databases = await Promise.all(pools.map(async pool => (await pool.query('select current_database() as name')).rows[0].name));
    const settings = (await pools[0].query("select key,value from app_settings where key in ('sync.enabled','update.enabled') order by key")).rows;
    assert.deepEqual(settings, [{ key: 'sync.enabled', value: 'false' }, { key: 'update.enabled', value: 'false' }]);
    const finalReport = (await pools[0].query("select id,status,summary_metrics,chart,param_options from reports where name='Fictional UI report review'")).rows;
    assert.equal(finalReport.length, 1);
    assert.equal(finalReport[0].status, 'draft');
    for (const key of ['summary_metrics', 'chart', 'param_options']) assert.equal(finalReport[0][key], null);
    const proof = { checkedAt: new Date().toISOString(), command: 'node packages/cli/dev.mjs report run r-bugfix-date-range --param from=2026-01-01 --param to=2026-11-12', results, isolation: { databases, bucket: process.env.S3_BUCKET, identityAdminAdapter: process.env.IDENTITY_ADMIN_ADAPTER, settings }, finalReport };
    fs.writeFileSync(path.join(__dirname, 'report-cli-isolation-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log('PASS CLI flat dates JSON/CSV/PDF, actual PostgreSQL ownership, sync off, update checks off, persisted Draft with SQL NULL metadata');
  } finally { await Promise.all(pools.map(pool => pool.end())); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
