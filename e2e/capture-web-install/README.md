# Install guide captures

The terminal and file-browser illustrations are SVG components in `apps/web/src/docs/InstallGuideIllustration.tsx`. They use the same command strings as the guide. Browser screenshots come from the actual sign-in theme and Studio.

Run these commands from the repository root. Use a disposable Keycloak realm with the default `labadmin` fixture. Never point the capture at an existing account. The capture opens the initial password-change form but does not submit a new password. Studio must already be running with development sign-in enabled.

```sh
docker run --detach --rm --name openldr-install-guide-auth \
  --memory=1g --publish 127.0.0.1:18591:8080 \
  --volume "$PWD/infra/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro" \
  --volume "$PWD/deploy/keycloak/themes/openldr:/opt/keycloak/themes/openldr:ro" \
  --env KC_HTTP_RELATIVE_PATH=/auth --env KC_HOSTNAME_STRICT=false \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm
```

Wait for `http://127.0.0.1:18591/auth/realms/openldr/.well-known/openid-configuration` to return successfully. Then run:

```sh
INSTALL_GUIDE_ISOLATED=yes node e2e/capture-web-install/capture.mjs
```

Set `CHROMIUM_PATH` if Playwright's Chromium is unavailable. `INSTALL_GUIDE_AUTH_URL` and `INSTALL_GUIDE_STUDIO_URL` override the default local addresses. Screenshots are written to `apps/web/public/docs-images/install` in both themes, at three device pixels per CSS pixel. Only the current capture browser's Studio preferences are replaced; the server's saved preferences stay unchanged.

Stop the disposable container afterwards:

```sh
docker stop openldr-install-guide-auth
```

This capture does not prove that a complete fresh OpenLDR stack installs on Windows, macOS or Linux. Installer shell tests use simulated external commands. Check those layers separately.

## Restored first-sign-in guide

The current Install page reuses these captures. Its six numbered steps select crops in `apps/web/src/docs/web-guide-focus.json`. The focused screenshot component uses the matching `-light.png` file in light mode. Inline and expanded views share the same crop and clear area.

These captures show the real login and password-change forms. They do not record submitting the password change or an authenticated redirect back to Studio. The Studio documentation capture comes from the development app. Do not treat these pictures as a complete fresh-install acceptance test.

## Current local sign-in captures

`fixture.mjs` serves the real API routes and the built Studio app against separate databases. It binds only to `127.0.0.1`. It refuses database ports other than 18793, storage other than 18794, authentication bypass and an authentication mode other than local.

The capture on 2026-11-12 used the Docker Compose project `openldr-first-signin-20261112`. It created its own Postgres and Garage volumes. The existing installation was not stopped or reconfigured. The private configuration, setup codes and test passwords stay outside Git, under `/home/fredrick/.codex/fixtures/openldr-first-signin-20261112`. The Compose file there contains the exact resource configuration.

The capture environment has these resources:

| Resource | Address or database |
| --- | --- |
| Postgres | `127.0.0.1:18793`, with databases `openldr`, `openldr_target`, `openldr_light`, `openldr_target_light` |
| Garage | `127.0.0.1:18794`, with its own bucket and credentials |
| Dark capture server | `127.0.0.1:18791`, using the first database pair |
| Light capture server | `127.0.0.1:18792`, using the second database pair |

Build Studio first with `pnpm --filter @openldr/studio build`. With that disposable environment provisioned, run one server per terminal:

```sh
INSTALL_GUIDE_ISOLATED=yes INSTALL_GUIDE_FIXTURE=/path/to/private/capture-environment node e2e/capture-web-install/fixture.mjs
INSTALL_GUIDE_ISOLATED=yes INSTALL_GUIDE_VARIANT=light INSTALL_GUIDE_FIXTURE=/path/to/private/capture-environment node e2e/capture-web-install/fixture.mjs
```

The servers migrate and seed only the disposable databases, then generate their setup codes. They do not use the repository's `.env`. Do not substitute a shared database. Use new empty capture databases for another full first-setup capture.

Run the browser capture against those servers:

```sh
INSTALL_GUIDE_ISOLATED=yes INSTALL_GUIDE_FIXTURE=/path/to/private/capture-environment node e2e/capture-web-install/capture-local.mjs
```

Set `CHROMIUM_PATH` if needed. Each picture has 5120 by 3200 pixels. The script submits the real setup, creates a temporary test user, signs that user in, changes the temporary password and opens Docs. It also confirms that the replacement password signs in without another forced change. No API response is mocked. It records response statuses and crop coordinates in the private capture directory, without putting passwords in the proof record.

This checks the local sign-in flow on real Postgres. It does not test the packaged installer, Windows Server preparation, HTTPS certificates or a third-party identity provider. The preserved Keycloak pictures remain a separate path in Install.
