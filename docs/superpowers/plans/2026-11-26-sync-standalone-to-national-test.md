# Test plan: a standalone lab syncing to a national server

Date: 2026-11-26. Asked for by the operator. Nothing runs until the operator approves.

## Why

Distributed sync is built and has a two-instance test (`pnpm sync:e2e`): a lab and a central in one
process, over real HTTP with real Keycloak tokens. It has never run between two machines over a real
network, and never with the standalone app as the lab. A lab deploying the standalone beside a
national server needs that to work.

## Set-up

- **National:** a separate server-edition install on the Linux box (`fredrick-station`), made with the
  normal installer, with its own compose project, ports and data. Its public address and Keycloak
  hostname are the box's tailnet name, so the laptop reaches it over Tailscale and its tokens carry
  that issuer. It is removed after the test. The operator chose this on 2026-11-26 over openldr.online
  (public) and the dev stack.
- **Lab:** the Windows work laptop, standalone app, with its own data folder.
- **When:** after 0.1.13 is released. Both sides then run the same version.

Why not the dev stack: it runs with `AUTH_DEV_BYPASS=true`, so it would not test real sign-in, and its
Keycloak issuer is `http://localhost:8180`, which the laptop's tokens would not match. Changing either
means restarting it, which AGENTS.md section 7 forbids for a check.

To check before step 1: the installer accepts the tailnet name as the public address, and whether the
lab's sync client accepts plain HTTP over Tailscale or needs HTTPS (a self-signed certificate the
laptop trusts, or Tailscale's own certificate for the tailnet name).

## Steps

1. **Enroll the lab at national.** On the test install, Settings > Sites > Enroll site, named
   `laptop-sync-test`. Note the site id, client id and one-time secret, the central URL (the tailnet
   address) and the OIDC issuer. Pass the secret to the laptop privately.
2. **Link the lab.** On the laptop, Settings > Distributed sync: enter the central URL, site id, issuer,
   client id and secret. Choose **Bidirectional**. Save, then turn **Enable sync** on.
3. **Push up.** On the laptop, register a test patient and an order with one result (names starting
   `SYNC-TEST`). Wait for a push cycle. Check the laptop's sync status shows it sent.
4. **See it at national.** On the test install, find the `SYNC-TEST` patient and result, stamped with
   the laptop's site id. Record what the test install's Sites page says about the lab's last contact.
5. **Pull down.** On the test install, change something national owns: publish a small form. Wait for a
   pull cycle. Check it appears on the laptop, read-only.
6. **Offline path.** On the laptop, `openldr sync export` to a file. On the test
   install, `openldr sync import` that file inside its api container. Check it applies, or reports nothing new.
7. **Cut off.** Revoke `laptop-sync-test` at national. Make one more record on the laptop. Check its
   push is refused (403) and the laptop's sync status says so.
8. **A lab account does not travel.** Create a test admin user on the laptop. Check it never appears on
   the test install.

## Evidence

Screenshots of each step on the operator's Artifact page, with the laptop's sync status and the
test install's Sites page. Server log lines for the push, the pull and the 403.

## What stays behind

Nothing, once the test install is removed (its compose project, volumes and folder). The laptop's
sync settings are switched off after step 7. Nothing public is touched.

## Out of scope

- Several standalone machines at one lab. The recommended set-up is one machine holding the data and
  the others using it in a browser.
- A regional tier between lab and national. It is not built.
- Plugin data. Plugins are installed per site, and a plugin's own tables do not sync.
