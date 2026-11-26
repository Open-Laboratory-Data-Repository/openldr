# Test plan: a standalone lab syncing to a national server

Date: 2026-11-26. Asked for by the operator. Nothing runs until the operator approves.

## Why

Distributed sync is built and has a two-instance test (`pnpm sync:e2e`): a lab and a central in one
process, over real HTTP with real Keycloak tokens. It has never run between two machines over a real
network, and never with the standalone app as the lab. A lab deploying the standalone beside a
national server needs that to work.

## Set-up

- **National:** openldr.online (the droplet), server edition with Keycloak.
- **Lab:** the Windows work laptop, standalone app, with its own data folder.
- **When:** after 0.1.13 is released. Both sides then run the same version. Today the droplet is on
  0.1.13-rc.1 and the laptop on 0.1.13-rc.2, and the test should not mix versions.

Checked on 2026-11-26 (read-only): the droplet's `.env` sets `KEYCLOAK_ADMIN_CLIENT_ID` and
`KEYCLOAK_ADMIN_CLIENT_SECRET`, which enrollment needs, and its Keycloak container is up.

## Steps

1. **Enroll the lab at national.** On openldr.online, Settings > Sites > Enroll site, named
   `laptop-sync-test`. Note the site id, client id and one-time secret, the central URL
   (`https://openldr.online`) and the OIDC issuer. Pass the secret to the laptop privately.
2. **Link the lab.** On the laptop, Settings > Distributed sync: enter the central URL, site id, issuer,
   client id and secret. Choose **Bidirectional**. Save, then turn **Enable sync** on.
3. **Push up.** On the laptop, register a test patient and an order with one result (names starting
   `SYNC-TEST`). Wait for a push cycle. Check the laptop's sync status shows it sent.
4. **See it at national.** On openldr.online, find the `SYNC-TEST` patient and result, stamped with
   the laptop's site id. Record what the droplet's Sites page says about the lab's last contact.
5. **Pull down.** On openldr.online, change something national owns: publish a small form. Wait for a
   pull cycle. Check it appears on the laptop, read-only.
6. **Offline path.** On the laptop, `openldr sync export` to a file. On the droplet,
   `openldr sync import` that file inside the api container. Check it applies, or reports nothing new.
7. **Cut off.** Revoke `laptop-sync-test` at national. Make one more record on the laptop. Check its
   push is refused (403) and the laptop's sync status says so.
8. **A lab account does not travel.** Create a test admin user on the laptop. Check it never appears on
   openldr.online.

## Evidence

Screenshots of each step on the operator's Artifact page, with the laptop's sync status and the
droplet's Sites page. Server log lines for the push, the pull and the 403.

## What stays behind

- `SYNC-TEST` records on openldr.online, which is a public install. Anyone who can sign in there can
  see them. The operator decides before step 3 whether test data may go there.
- The revoked site and its Keycloak client on the droplet, unless deleted after the test.
- The laptop's sync settings, switched off after step 7.

## Out of scope

- Several standalone machines at one lab. The recommended set-up is one machine holding the data and
  the others using it in a browser.
- A regional tier between lab and national. It is not built.
- Plugin data. Plugins are installed per site, and a plugin's own tables do not sync.
