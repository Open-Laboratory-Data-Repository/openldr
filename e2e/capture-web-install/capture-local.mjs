// Real browser capture of the isolated local sign-in fixture. No API responses are mocked.
import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.INSTALL_GUIDE_ISOLATED !== 'yes' || !process.env.INSTALL_GUIDE_FIXTURE) throw new Error('Use the isolated fixture from README.md.');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const fixture = process.env.INSTALL_GUIDE_FIXTURE;
const out = resolve(repo, 'apps/web/public/docs-images/install');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const proof = [];
const geometry = {};
try {
  for (const theme of ['dark', 'light']) {
    const base = `http://127.0.0.1:${theme === 'dark' ? 18791 : 18792}`;
    const credentialsPath = resolve(fixture, `capture-credentials-${theme}.json`);
    const credentials = existsSync(credentialsPath) ? JSON.parse(readFileSync(credentialsPath)) : { username: 'guide.admin', password: randomBytes(20).toString('base64url'), temporary: randomBytes(20).toString('base64url'), replacement: randomBytes(20).toString('base64url') };
    writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 4, colorScheme: theme });
    await context.addInitScript(theme => {
      localStorage.setItem('openldr-theme', theme);
      localStorage.setItem('openldr-sidebar-collapsed', 'false');
      localStorage.setItem('openldr-locale', 'en');
      localStorage.setItem('i18nextLng', 'en');
    }, theme);
    const page = await context.newPage();
    const shot = async (name, selectors = []) => {
      await page.addStyleTag({ content: '*,*::before,*::after {animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.screenshot({ path: resolve(out, `${name}${theme === 'light' ? '-light' : ''}.png`) });
      if (theme === 'dark') geometry[name] = await Promise.all(selectors.map(async selector => {
        const box = await page.locator(selector).boundingBox(); if (!box) throw new Error('Missing target '+selector);return box;
      }));
    };
    const config = await context.request.get(base+'/api/config');
    const cfg = await config.json();
    if (cfg.auth?.mode !== 'local' && cfg.authMode !== 'local' && cfg.authAdapter !== 'local') {
      // The shape is checked below by the real setup page too; include only non-secret config keys.
      if (!JSON.stringify(cfg).includes('local')) throw new Error('Fixture is not local authentication');
    }
    await page.goto(base+'/studio/');
    await page.getByRole('heading', { name: 'Create the administrator', exact: true }).waitFor();
    await shot('local-setup-open', ['h1']);
    const code = JSON.parse(readFileSync(resolve(fixture, `setup-code-${theme}.json`))).setupCode;
    await page.getByLabel('Setup code', { exact: true }).fill(code);
    await shot('local-setup-code', ['#local-setup-code']);
    await page.getByLabel('Username', { exact: true }).fill(credentials.username);
    await shot('local-setup-username', ['#local-setup-username']);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByLabel('Repeat password', { exact: true }).fill(credentials.password);
    await shot('local-setup-password', ['#local-setup-password', '#local-setup-repeat']);
    await shot('local-setup-submit', ['button[type=submit]']);
    const setupResponse = page.waitForResponse(r => r.url() === base+'/api/auth/setup' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create the administrator', exact: true }).click();
    const setup = await setupResponse;if(!setup.ok())throw new Error('Setup failed '+setup.status());
    const admin = await setup.json();
    await page.locator('a[href="/studio/docs"]').waitFor();
    await page.locator('a[href="/studio/docs"]').click();
    await page.getByRole('heading', { name: 'Start here', exact: true }).waitFor();
    await shot('local-open-docs', ['a[href="/studio/docs"]']);
    await shot('local-start-here', ['h1']);
    const createUser = await context.request.post(base+'/api/users', { headers: { Authorization: 'Bearer '+admin.accessToken }, data: { username: 'guide.user', firstName: 'Guide', lastName: 'User', roles: ['lab_technician'], password: credentials.temporary } });
    if(createUser.status()!==201)throw new Error('Fixture user create failed '+createUser.status()+' '+await createUser.text());
    proof.push({ theme, setupStatus: setup.status(), temporaryUserStatus: createUser.status() });
    await context.close();

    const loginContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 4, colorScheme: theme });
    await loginContext.addInitScript(theme => {
      localStorage.setItem('openldr-theme', theme);localStorage.setItem('openldr-locale', 'en');localStorage.setItem('i18nextLng','en');
    },theme);
    const login = await loginContext.newPage();
    await login.goto(base+'/studio/');
    await login.getByRole('heading',{name:'Sign in to OpenLDR',exact:true}).waitFor();
    const loginShot = async (name,selectors) => {
      await login.addStyleTag({content:'*,*::before,*::after {animation:none!important;transition:none!important;caret-color:transparent!important}'});
      await login.screenshot({path:resolve(out,`${name}${theme==='light'?'-light':''}.png`)});
      if(theme==='dark')geometry[name]=await Promise.all(selectors.map(s=>login.locator(s).boundingBox()));
    };
    await loginShot('local-login-open',['h1']);
    await login.getByLabel('Username or email',{exact:true}).fill('guide.user');
    await login.getByLabel('Password',{exact:true}).fill(credentials.temporary);
    await loginShot('local-login-credentials',['#local-sign-in-username','#local-sign-in-password']);
    await loginShot('local-login-submit',['button[type=submit]']);
    const loginResponse=login.waitForResponse(r=>r.url()===base+'/api/auth/login'&&r.request().method()==='POST');
    await login.getByRole('button',{name:'Sign in',exact:true}).click();
    const loggedIn=await loginResponse;if(!loggedIn.ok())throw new Error('Temporary sign-in failed');
    await login.getByRole('heading',{name:'Choose a new password',exact:true}).waitFor();
    await login.getByLabel('Current password',{exact:true}).fill(credentials.temporary);
    await loginShot('local-change-current',['#local-change-current']);
    await login.getByLabel('New password',{exact:true}).fill(credentials.replacement);
    await login.getByLabel('Repeat password',{exact:true}).fill(credentials.replacement);
    await loginShot('local-change-new',['#local-change-new','#local-change-repeat']);
    await loginShot('local-change-submit',['button[type=submit]']);
    const changedResponse=login.waitForResponse(r=>r.url()===base+'/api/auth/change-password'&&r.request().method()==='POST');
    await login.getByRole('button',{name:'Change password',exact:true}).click();
    const changed=await changedResponse;if(!changed.ok())throw new Error('Password change failed '+changed.status());
    await login.locator('a[href="/studio/docs"]').waitFor();
    await login.locator('a[href="/studio/docs"]').click();
    await login.getByRole('heading',{name:'Start here',exact:true}).waitFor();
    proof.at(-1).loginStatus=loggedIn.status();proof.at(-1).passwordChangeStatus=changed.status();proof.at(-1).studioAfterChange=true;
    await loginContext.close();
    const verify=await browser.newContext();
    const signedIn=await verify.request.post(base+'/api/auth/login',{data:{username:'guide.user',password:credentials.replacement}});
    if(!signedIn.ok())throw new Error('New password cannot sign in');
    const result=await signedIn.json();if(result.mustChangePassword)throw new Error('Password change flag still set');
    proof.at(-1).newPasswordLoginStatus=signedIn.status();await verify.close();
    console.log(`PASS ${theme}: first administrator created, temporary user signed in, forced password changed, Studio and Docs opened, new password accepted`);
  }
  writeFileSync(resolve(fixture,'capture-proof.json'),JSON.stringify(proof,null,2));
  writeFileSync(resolve(fixture,'capture-geometry.json'),JSON.stringify(geometry,null,2));
} finally {await browser.close();}
