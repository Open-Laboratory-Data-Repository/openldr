// Fresh local sign-in capture server. It refuses databases outside the disposable Compose project.
import { register } from 'tsx/esm/api';
import { parse } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register();
const repo = fileURLToPath(new URL('../../', import.meta.url));
const fixture = process.env.INSTALL_GUIDE_FIXTURE;
if (!fixture || process.env.INSTALL_GUIDE_ISOLATED !== 'yes') throw new Error('Set the disposable fixture directory and explicit isolation guard.');
const env = parse(readFileSync(resolve(fixture, '.env')));
const variant = process.env.INSTALL_GUIDE_VARIANT ?? 'dark';
if (!['dark', 'light'].includes(variant)) throw new Error('Unknown fixture variant');
if (variant === 'light') {
  env.INTERNAL_DATABASE_URL = env.INTERNAL_DATABASE_URL.replace(/\/openldr$/, '/openldr_light');
  env.TARGET_DATABASE_URL = env.TARGET_DATABASE_URL.replace(/\/openldr_target$/, '/openldr_target_light');
  env.PORT = '18792';
}
for (const key of ['INTERNAL_DATABASE_URL', 'TARGET_DATABASE_URL']) {
  const url = new URL(env[key]);
  if (url.hostname !== '127.0.0.1' || url.port !== '18793' || !['/openldr', '/openldr_target', '/openldr_light', '/openldr_target_light'].includes(url.pathname)) throw new Error('Refuse database outside the isolated fixture');
}
if (env.S3_ENDPOINT !== 'http://127.0.0.1:18794' || env.AUTH_ADAPTER !== 'local' || env.AUTH_DEV_BYPASS !== 'false') throw new Error('Refuse shared storage or authentication bypass');
process.chdir(fixture);
process.env.WEB_DIST_DIR = resolve(repo, 'apps/studio/dist');
const { ConfigSchema } = await import(pathToFileURL(resolve(repo, 'packages/config/src/schema.ts')).href);
const { createDbContext, createAppContext, seedEssentials, createSetupCode } = await import(pathToFileURL(resolve(repo, 'packages/bootstrap/src/index.ts')).href);
const { buildApp } = await import(pathToFileURL(resolve(repo, 'apps/server/src/app.ts')).href);
const cfg = ConfigSchema.parse(env);
const db = await createDbContext(cfg);
try {
  const result = await db.migrateAll();
  if (result.internal.error || result.external.error) throw result.internal.error ?? result.external.error;
} finally { await db.close(); }
const ctx = await createAppContext(cfg);
await seedEssentials(ctx);
const code = await createSetupCode(ctx);
writeFileSync(resolve(fixture, `setup-code-${variant}.json`), JSON.stringify({ setupCode: code }), { mode: 0o600 });
const app = await buildApp(ctx);
await app.listen({ host: '127.0.0.1', port: cfg.PORT });
console.log(`ISOLATED SIGN-IN FIXTURE READY variant=${variant} port=${cfg.PORT} auth=local bypass=false`);
const stop = async () => { await app.close(); await ctx.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
