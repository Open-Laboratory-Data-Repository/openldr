// Only the disposable review API and Studio on ports 3010 and 5190.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../../../..');
const { chromium, expect } = require(path.join(repo, 'e2e/node_modules/@playwright/test'));
const ts = require(path.join(repo, 'node_modules/typescript'));
const apiBase = 'http://127.0.0.1:3010/api';
const studioBase = 'http://127.0.0.1:5190/studio';
function sourceExports(relative) {
  const source = fs.readFileSync(path.join(repo, relative), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const output = {};
  new Function('exports', javascript)(output);
  return output;
}
const messages = Object.fromEntries(['en', 'fr', 'pt'].map(language => [language, sourceExports('apps/studio/src/i18n/' + language + '.ts')[language]]));
const catalog = sourceExports('packages/rbac/src/catalog.ts').CAPABILITY_GROUPS;
async function api(route, method = 'GET', body) {
  const response = await fetch(apiBase + route, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  assert(response.ok, method + ' ' + route + ' HTTP ' + response.status);
  return response.status === 204 ? null : response.json();
}
function save(name, value) { fs.writeFileSync(path.join(__dirname, 'copy-' + name + '.json'), JSON.stringify(value, null, 2) + '\n'); }
(async () => {
  const proof = { apiBase, studioBase, capturedAt: new Date().toISOString(), deviceScaleFactor: 4, languages: {}, blockedMutations: [], limits: [] };
  const previousPreferences = await api('/me/preferences');
  const initialLab = await api('/settings/lab');
  const initialRoles = await api('/roles');
  const forms = await api('/forms');
  const source = forms.find(form => form.status === 'published' && /lab.*order/i.test(form.name)) || forms.find(form => form.status === 'published' && form.fhirResourceType === 'ServiceRequest');
  assert(source, 'Fresh seeded published Lab order form is missing');
  const originalSource = await api('/forms/' + source.id);
  let draft;
  const fixturePath = path.join(__dirname, 'copy-fixture.json');
  if (fs.existsSync(fixturePath)) {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    draft = await api('/forms/' + fixture.draft.id);
    assert.equal(draft.status, 'draft');
  } else {
    draft = await api('/forms/' + source.id + '/duplicate', 'POST', {});
    assert.equal(draft.status, 'draft');
    save('fixture', { source: { id: source.id, name: source.name }, draft: { id: draft.id, name: draft.name, status: draft.status }, reason: 'Fictional draft for View/Run inspection. No answers submitted.' });
  }
  const sourceVersions = await api('/forms/' + source.id + '/versions');
  proof.fixture = { source: source.id, draft: draft.id, status: draft.status, sourceVersions: sourceVersions.length };
  const browser = await chromium.launch({ headless: true, executablePath: '/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 4 });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const routePath = new URL(request.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && routePath !== '/api/me/preferences') {
      proof.blockedMutations.push({ method: request.method(), path: routePath });
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  async function shot(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(__dirname, 'copy-' + name + '.png'), animations: 'disabled' });
  }
  try {
    for (const language of ['en', 'fr', 'pt']) {
      const strings = messages[language];
      await api('/me/preferences', 'PUT', { language, theme: 'dark', sidebarCollapsed: false });
      await page.goto(studioBase + '/settings/laboratory');
      const logo = page.getByTestId('logo-file');
      await logo.waitFor({ state: 'attached' });
      assert.deepEqual(initialLab.logo.mimeTypes, ['image/png', 'image/jpeg']);
      await expect(logo).toHaveAttribute('accept', 'image/png,image/jpeg');
      await expect(page.getByRole('button', { name: strings.settings.laboratory.chooseLogo, exact: true })).toBeVisible();
      await logo.setInputFiles({ name: 'fictional-logo.webp', mimeType: 'image/webp', buffer: Buffer.from('RIFFfictionalWEBP') });
      const toast = page.getByText(strings.settings.laboratory.logoType, { exact: true });
      await expect(toast).toBeVisible();
      await shot('logo-' + language);
      assert.deepEqual((await api('/settings/lab')).values, initialLab.values);
      proof.languages[language] = { logo: { toast: await toast.textContent(), accept: await logo.getAttribute('accept'), savedValuesUnchanged: true } };

      await page.goto(studioBase + '/settings/roles');
      await page.getByTestId('roles-menu-trigger').click();
      await page.getByTestId('create-role').click();
      const sheet = page.getByRole('dialog').last();
      await expect(sheet.getByTestId('role-name')).toHaveValue('');
      const exposure = sheet.getByTestId('capability-group-data_exposure');
      const description = exposure.getByText(strings.settings.dataExposure.description, { exact: true });
      await description.scrollIntoViewIfNeeded();
      await expect(description).toBeVisible();
      await shot('roles-' + language);
      const serverCatalog = await api('/roles/catalog');
      const metadata = serverCatalog.groups.flatMap(group => group.capabilities).find(capability => capability.key === 'data_exposure.manage');
      const sourceMetadata = catalog.flatMap(group => group.capabilities).find(capability => capability.key === 'data_exposure.manage');
      assert.equal(metadata.description, messages.en.settings.dataExposure.description);
      assert.equal(metadata.description, sourceMetadata.description);
      proof.languages[language].role = { renderedDescription: await description.textContent(), serverDescription: metadata.description, blankUnsavedSheet: true };
      await page.keyboard.press('Escape');

      await page.goto(studioBase + '/forms');
      await page.getByPlaceholder(strings.forms.searchPlaceholder).fill(draft.name);
      const row = page.getByRole('row').filter({ has: page.getByText(draft.name, { exact: true }) });
      await expect(row.getByText(strings.forms.statusDraft, { exact: true })).toBeVisible();
      await row.getByRole('button', { name: strings.forms.rowActions.replace('{{name}}', draft.name), exact: true }).click();
      const viewRun = page.getByRole('menuitem', { name: strings.forms.viewRun, exact: true });
      await expect(viewRun).toBeEnabled();
      await viewRun.click();
      await expect(page).toHaveURL(studioBase + '/forms/' + draft.id);
      await expect(page.getByText('This form is not published. Submission is disabled until it is published.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Form actions', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Submit', exact: true })).toBeDisabled();
      await shot('draft-' + language);
      proof.languages[language].draft = { viewRunOpened: true, submitDisabled: true, banner: 'This form is not published. Submission is disabled until it is published.', capturePageActionsRemainEnglish: true };
      await page.keyboard.press('Escape');

      await page.goto(studioBase + '/forms/' + source.id + '/builder');
      const readiness = page.getByText(strings.forms.captureEligible, { exact: true });
      await expect(readiness).toBeVisible();
      await shot('readiness-' + language);
      proof.languages[language].readiness = { renderedDescription: await readiness.textContent(), source: 'forms-runtime/SubmissionReadiness.tsx' };

      if (sourceVersions.length) {
        await page.getByRole('button', { name: strings.formBuilder.header.actions, exact: true }).click();
        await page.getByRole('menuitem', { name: strings.formBuilder.header.versions, exact: true }).click();
        const versions = page.getByRole('dialog').last();
        const latest = sourceVersions[0];
        await versions.getByRole('button', { name: strings.formBuilder.versions.rowActions.replace('{{n}}', String(latest.version)), exact: true }).click();
        await page.getByRole('menuitem', { name: strings.formBuilder.versions.restore, exact: true }).click();
        const confirmation = page.getByRole('alertdialog');
        await expect(confirmation.getByText(strings.formBuilder.versions.confirmBody, { exact: true })).toBeVisible();
        await shot('restore-' + language);
        proof.languages[language].restore = { renderedDescription: await confirmation.getByText(strings.formBuilder.versions.confirmBody, { exact: true }).textContent(), confirmed: false };
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else {
        proof.languages[language].restore = { status: 'UNPROVEN', reason: 'Seeded published source has no version snapshot. No publication or restore mutation authorized.' };
      }
    }
    assert.deepEqual(await api('/roles'), initialRoles);
    assert.deepEqual((await api('/settings/lab')).values, initialLab.values);
    assert.deepEqual(await api('/forms/' + source.id), originalSource);
    assert.equal((await api('/forms/' + draft.id)).status, 'draft');
    assert.deepEqual(proof.blockedMutations, []);
    proof.savedState = { rolesUnchanged: true, labIdentityUnchanged: true, sourceFormUnchanged: true, ownedCopyRemainsDraft: true, browserMutationRequests: 0 };
    console.log('COPY LIVE PASS: en/fr/pt logo rejection and role descriptions; Draft View/Run opens, Submit disabled; readiness banner and restore confirmation inspected without restoring.');
  } catch (error) {
    proof.failure = error.message;
    await shot('failure');
    throw error;
  } finally {
    await context.close();
    await api('/me/preferences', 'PUT', { language: previousPreferences.language ?? null, theme: previousPreferences.theme ?? null, sidebarCollapsed: previousPreferences.sidebarCollapsed ?? null });
    proof.preferencesRestored = true;
    save('live-proof', proof);
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
