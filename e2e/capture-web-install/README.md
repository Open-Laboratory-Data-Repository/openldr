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
