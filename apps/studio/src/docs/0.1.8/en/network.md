# Network

Network holds two lists that an administrator keeps. The first is the certificates this OpenLDR trusts when it calls another server over HTTPS, such as a hub with its own certificate. The second is the hosts a workflow may call. You need the **Manage network trust** permission.

This guide has no clip yet. Each task is a few steps on one page.

## Trust another OpenLDR's certificate

Do this when sync to a hub fails with a certificate error, or a workflow must call a server that made its own certificate.

1. Ask the person who runs the other server for its certificate fingerprint. Get it by phone or in person, not from the server's own page.
2. Open **Settings**, then **Network**.
3. Open the dots menu at the top right and select **Add certificate**.
4. In **Address**, type the other server's address, such as `hub.example.org` or `hub.example.org:8443`.
5. Open the dots menu in the sheet and select **Read certificate**.
6. Compare the **Fingerprint** on the screen with the one you were given, pair by pair.
7. If they are the same, open the dots menu in the sheet and select **Save**.
8. Restart OpenLDR. See **Restart OpenLDR** below.

**Expected result:** after the restart, the certificate's **State** is **In use**. Before it, the state is **After restart**.

If the two fingerprints differ, stop. Do not save.

If you have the certificate as a file, paste its text into **Or paste it** in step 4 instead of typing an address. Never paste a private key. OpenLDR refuses it and saves nothing.

From the command line, on the desktop app or the standalone launcher:

```
openldr-standalone cli -- trust add --address hub.example.org:8443 --fingerprint <SHA-256>
```

On a Docker install, the `openldr` command cannot ask a question. Give the fingerprint, and it saves only when the certificate matches:

```
openldr trust add --address hub.example.org:8443 --fingerprint <SHA-256>
openldr trust add data/hub.pem --fingerprint <SHA-256>
```

With a file and no `--fingerprint`, the command prints the certificate's fingerprint and saves nothing. Compare it, then run the command again with it. With `--address`, `--fingerprint` is always needed. Without it the command stops before it contacts the server.

## Restart OpenLDR

OpenLDR reads its trusted certificates only when it starts. A certificate you add or remove takes effect after a restart.

- **Desktop app:** open the OpenLDR icon in the system tray, select **Quit**, then open OpenLDR again.
- **Standalone launcher:** run `openldr-standalone stop`, then `openldr-standalone start`. Pass the same `--data-dir` to `stop`, if you used one. Then repeat your original `start` command, with its sharing and port options. Without them, `stop` can look in another folder, and `start` can come up without sharing.
- **Docker install:** in the install folder, run `docker compose restart api`.

**Expected result:** the **State** column changes from **After restart** to **In use**.

## Remove a trusted certificate

1. Open **Settings**, then **Network**.
2. In the row of the certificate, open the dots menu and select **Remove**.
3. Read the question, then select **Remove**.
4. Restart OpenLDR.

**Expected result:** a certificate the server has loaded shows **Removed after restart** until the restart, and then the row is gone. One that was still waiting for a restart goes at once.

Removing drops this entry only. A server that is trusted in another way, such as through a public certificate authority, stays trusted.

From the command line: `openldr trust remove <fingerprint> --force`.

## Let a workflow call another host

A workflow's HTTP step can call only the hosts on this list, and this OpenLDR itself when its switch is on. See **Let a workflow call this OpenLDR** below.

1. Open **Settings**, then **Network**.
2. Select the **Workflow hosts** tab.
3. Open the dots menu at the top right and select **Add host**.
4. In **Host**, type the host name or IP address, such as `hub.example.org`. Give no port and no path.
5. Open the dots menu in the sheet and select **Save**.

**Expected result:** the host is in the list with the source **Set here**. A workflow can call it at once. No restart is needed.

A host here covers every web service on that host, on any port.

From the command line: `openldr workflows hosts add hub.example.org`. To remove one: `openldr workflows hosts remove hub.example.org --force`.

## Let a workflow call this OpenLDR

Do this when a workflow must call this OpenLDR's own web address, for example to fetch results on a schedule.

1. Open **Settings**, then **Network**.
2. Select the **Workflow hosts** tab.
3. Turn on **Let workflows call this OpenLDR**.

**Expected result:** the switch is on. The address beside it is the only one this allows. Other programs on the same computer stay out of reach.

From the command line: `openldr workflows hosts self on`, and `off` to turn it off.

## Unlock the list

A power cut or a crash during a change can leave the list of certificates locked. The page then says a change was interrupted, and no change goes through.

1. Make sure nobody else is changing the list right now.
2. Open the dots menu at the top right and select **Unlock**.
3. Read the question, then select **Unlock**.

**Expected result:** the note is gone and you can add or remove a certificate again.

**Unlock** appears once the lock is 30 seconds old. That age does not prove the change has stopped. That is why step 1 comes first.

From the command line: `openldr trust unlock --force`.

## Limits

- A new or removed certificate takes effect only after a restart. A workflow host takes effect at once.
- A host with the source **Server setting** comes from `WORKFLOW_HTTP_ALLOWLIST` on the server. Change it there.
- The page can show the list without letting you change it. It then says why at the top. An install made before this page existed may need one change by the person who runs the server. The website's environment guide explains `TRUSTED_CA_FILE`.

## Troubleshooting

- **Nothing answered at that address.** Check the address and the port, and that the other server is on. This computer must be able to reach it.
- **That certificate is already trusted.** It is in the list. Check its **State**: it may still need a restart.
- **The list is being changed.** Someone else is saving a change. Try again in a moment. If the page says a change was interrupted, see **Unlock the list**.
- **The page could not be refreshed.** What you see may be out of date. Open the dots menu at the top right and select **Refresh**.
- **Sync still fails after you added the certificate.** Restart OpenLDR, then check that the state is **In use**. Check too that the certificate names the address you use for the hub.

## Related guides

- [Connectors](/docs/connectors)
- [Distributed Sync](/docs/sync)
- [Workflows](/docs/workflows)
