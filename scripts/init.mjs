import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { select, input, confirm } from '@inquirer/prompts';
import { formatIpChoices, isValidFqdn } from './init/host-detect.mjs';
import { isPortFree } from './init/port-check.mjs';
import { computeEnv } from './init/config-compute.mjs';
import { renderRealm } from './init/realm-render.mjs';
import { prepareProdEnv, patchRealmSecrets, signInModeOf } from './init/secrets.mjs';
import { planCerts } from './init/certs.mjs';
import { launchStack, COMPOSE_ARGS } from './init/launch.mjs';
import { healthUrl, pollHealth } from './init/verify.mjs';

async function askPort(label, def) {
  for (;;) {
    const v = Number(await input({ message: `${label} port`, default: String(def) }));
    if (!Number.isInteger(v) || v < 1 || v > 65535) { console.log('  invalid port'); continue; }
    if (!(await isPortFree(v))) {
      const go = await confirm({ message: `port ${v} looks busy — use it anyway?`, default: false });
      if (!go) continue;
    }
    return v;
  }
}

async function main() {
  const kind = await select({ message: 'Address the server by', choices: [{ name: 'IP', value: 'ip' }, { name: 'Domain', value: 'domain' }] });
  let host;
  if (kind === 'ip') {
    const choices = formatIpChoices();
    host = await select({ message: 'Which address?', choices: [...choices.map((c) => ({ name: `${c.address} (${c.name})`, value: c.address })), { name: 'enter manually', value: '__manual__' }] });
    if (host === '__manual__') host = await input({ message: 'IP address' });
  } else {
    host = await input({ message: 'Domain (FQDN)', validate: (s) => isValidFqdn(s) || 'invalid hostname' });
  }

  const tlsMode = await select({ message: 'TLS', choices: [
    { name: 'Self-signed (lab/internal)', value: 'self-signed' },
    { name: "Let's Encrypt (public domain)", value: 'letsencrypt' },
    { name: 'Bring your own cert', value: 'byo' },
  ] });
  let email, certPath, keyPath;
  if (tlsMode === 'letsencrypt') email = await input({ message: "Email for Let's Encrypt" });
  if (tlsMode === 'byo') { certPath = await input({ message: 'fullchain cert path' }); keyPath = await input({ message: 'private key path' }); }

  const httpPort = await askPort('HTTP', 80);
  const httpsPort = await askPort('HTTPS', 443);

  // Sign-in is chosen once, on the first run. An existing .env.prod keeps its mode: the database
  // records the mode it first started with, and moving between modes is not supported. An
  // .env.prod with no AUTH_ADAPTER line is a Keycloak install made before local sign-in existed.
  const firstRun = !existsSync('.env.prod');
  const auth = firstRun
    ? await select({ message: 'Sign-in', default: 'local', choices: [
      { name: 'OpenLDR accounts, called local. No Keycloak runs.', value: 'local' },
      { name: 'Keycloak', value: 'keycloak' },
    ] })
    : signInModeOf(readFileSync('.env.prod', 'utf8'));
  if (!firstRun) console.log(`  Sign-in stays ${auth}. It was set when this install was first made.`);

  const env = computeEnv({ host, tlsMode, httpPort, httpsPort, email, auth });

  // .env.prod: create from example on first run, then merge (preserves secrets).
  if (firstRun) copyFileSync('.env.prod.example', '.env.prod');
  // Generate SECRETS_ENCRYPTION_KEY once. Replace the committed weak defaults (DB, storage, and for
  // Keycloak the admin and service-account secrets) with generated per-install secrets, keep the
  // postgres URLs in sync, and for Keycloak mint a one-time labadmin password and turn on the
  // keycloak compose profile. Idempotent: a re-run never rotates an already-generated secret.
  const secrets = prepareProdEnv(readFileSync('.env.prod', 'utf8'), { host, tlsMode, httpPort, httpsPort, email, auth });
  writeFileSync('.env.prod', secrets.envText);

  mkdirSync('deploy/nginx/certs', { recursive: true });
  // Rendered realm import, for Keycloak only. It is patched with the same admin client secret and
  // labadmin password, so a wizard install never imports a guessable admin credential.
  if (auth !== 'local') {
    writeFileSync(
      'infra/keycloak/openldr-realm.json',
      patchRealmSecrets(
        renderRealm(readFileSync('infra/keycloak/openldr-realm.json.template', 'utf8'), env.PUBLIC_ORIGIN),
        secrets,
      ),
    );
  }

  // certs
  const plan = planCerts({ tlsMode, host, email, certPath, keyPath });
  if (plan.kind === 'exec') execSync(plan.command, { stdio: 'inherit' });
  else if (plan.kind === 'copy') for (const f of plan.files) copyFileSync(f.from, f.to);
  else if (plan.kind === 'certbot') {
    // nginx must have a cert to start on :443, but certbot needs nginx (webroot) to issue the real
    // one — so bootstrap with a self-signed placeholder. Only when NO cert exists yet, so re-running
    // init never clobbers an already-issued Let's Encrypt cert. `pnpm run cert` installs the real one.
    if (!existsSync('deploy/nginx/certs/fullchain.pem')) {
      execSync(planCerts({ tlsMode: 'self-signed', host }).command, { stdio: 'inherit' });
    }
    console.log(`  Let's Encrypt selected: once up, run \`pnpm run cert\` (idempotent — it won't re-issue while a valid cert exists, so it's rate-limit safe). Ensure DNS for ${plan.domain} points here and port 80 is reachable.`);
  }

  console.log('\nLaunching the stack…');
  const code = launchStack({ auth });
  if (code !== 0) { console.error('docker compose up failed — see the output above.'); process.exit(code); }

  console.log('Waiting for /health…');
  const ok = await pollHealth(healthUrl(env.PUBLIC_ORIGIN, httpsPort));
  const keycloakLine = auth === 'local' ? '' : `\n  keycloak admin: ${env.PUBLIC_ORIGIN}/auth/admin`;
  console.log(ok
    ? `\n✅ up.\n  landing: ${env.PUBLIC_ORIGIN}/\n  studio:  ${env.PUBLIC_ORIGIN}/studio${keycloakLine}`
    : '\n⚠ health did not go green in time — check `docker compose -f docker-compose.prod.yml logs`.');
  if (auth === 'local') {
    printSetupCode(env.PUBLIC_ORIGIN);
    return;
  }
  // Surface the seeded lab-admin credential once. It is forced-temporary in the realm import, so the
  // operator must set a new password on first sign-in. It is also stored in .env.prod for reference.
  console.log(`\n  Initial lab admin sign-in: labadmin / ${secrets.labAdminPassword}  (you must change it on first login)`);
}

/** Ask the api container for a setup code, the way `openldr auth setup-code` runs on an install.
 *  The code is printed to this terminal only. It is not written to a file or a log. */
function printSetupCode(origin) {
  const cliArgs = ['exec', '-T', 'api', 'node', '/app/cli/dist/index.js', 'auth', 'setup-code', '--json'];
  const r = spawnSync('docker', [...COMPOSE_ARGS, ...cliArgs], { encoding: 'utf8' });
  const code = /"setupCode":\s*"([^"]+)"/.exec(r.stdout ?? '')?.[1];
  const again = `docker compose ${COMPOSE_ARGS.join(' ')} ${cliArgs.slice(0, -1).join(' ')}`;
  if (r.status === 0 && code) {
    console.log(`\n  Setup code: ${code}, valid for 30 minutes`);
    console.log(`  Open ${origin}/studio/ and enter it on the Create the administrator page.`);
    console.log(`  For a new code, run: ${again}`);
  } else if (/an administrator already exists/.test(r.stderr ?? '')) {
    console.log(`\n  An administrator already exists. Sign in at ${origin}/studio/`);
  } else {
    console.log('\n  Could not get a setup code yet. Once the api is up, run:');
    console.log(`    ${again}`);
    // One line of the reason, no more. It is the last thing the command printed.
    const reason = `${r.stdout ?? ''}\n${r.stderr ?? ''}\n${r.error?.message ?? ''}`
      .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1);
    if (reason) console.log(`  Reason: ${reason}`);
  }
}

main().catch((e) => {
  // A known operator-facing refusal prints its message only, not a stack trace.
  if (e?.code === 'PRE_GARAGE_INSTALL') console.error(`\n${e.message}`);
  else console.error(e);
  process.exit(1);
});
