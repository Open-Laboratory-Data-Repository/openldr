# Distributed Sync

**Distributed sync** links many labs to one **central** OpenLDR server over slow or intermittent links. Each lab runs a full OpenLDR CE install, works offline, and catches up whenever a connection is there.

- **Up, lab to central.** Data the lab owns: patients, lab requests, lab results, specimens and diagnostic reports. Central keeps a read-only mirror and never edits it. The lab stays the source of truth.
- **Down, central to lab.** Configuration central owns: forms, dashboards, report definitions and allowlisted settings, plus terminology (code systems and concept maps). Labs use these read-only.
- **Site stamping.** Every record carries the `site_id` of the lab that made it. Central scopes and de-duplicates by it, so two labs never collide even when they use the same local identifiers.

This guide takes about 30 minutes and needs two installs: one central, one lab. The pictures come from a single install with sync switched off, so they show the pages, not a live link. Select any picture or clip to enlarge it.

![A lab's Distributed sync page, on its Settings tab.](sync-settings-tab.png)

## Who can do what

| Permission | What it allows |
| --- | --- |
| **View sync** | See sync status and the Activity tab |
| **Manage sync** | Configure sync, enroll and manage sites, resolve divergences |

Both pages are under **Settings**: **Sites** on central, **Distributed sync** on a lab.

## Before you start

- **Central** enrols labs and holds the mirror. **Labs** connect to central and push their own data.
- Enrolment creates Keycloak clients, so the central Keycloak realm must give the admin service account the `manage-clients` and `view-clients` roles. The realm export shipped with OpenLDR includes them. A Keycloak container first started **before** distributed sync existed needs its realm imported again, or those two client roles added by hand. Otherwise creating the client fails.
- Use HTTPS for the central URL in production. The client secret travels once at enrolment, and lab tokens travel on every sync.
- The lab reaches central **server to server, over HTTPS**. If central uses a self-signed certificate, which is the installer default, the lab must be given central's public certificate to trust. A browser clicking through the warning is **not** enough: the lab's server checks the certificate on its own. See [Example 2](#example-2-trust-central-s-certificate-on-the-lab).

## Example 1: enroll a lab on central

Enrolment creates a confidential Keycloak client, `sync-<siteId>`, with a `site_id` token mapper. It generates the client's secret and adds a row to the sites list. The secret is shown **once** and can never be read again. If it is lost, rotate it.

![Central's Sites page and its menu: Enroll site, Download central certificate, Refresh.](sync-sites-menu.mp4)

1. On central, open **Settings**, then **Sites**.
2. Open the page's **⋯** menu and select **Enroll site**. Fill in:

   | Field | Notes |
   | --- | --- |
   | Site ID | A stable identifier for the lab, for example `lab-site-01`. Lowercase letters, digits and hyphens, 1 to 63 characters, not starting with a hyphen. It is also the Keycloak client id and the sites-list key. |
   | Name | An optional readable label. |
   | Central URL | The public address the lab will reach central on, for example `https://central.example.org`. Required. |

   ![The Enroll site dialog with Site ID, Name and Central URL.](sync-enroll-site.png)

3. Select **Enroll**. A one-time dialog shows what the lab needs: **client id**, **client secret**, **OIDC issuer** and **central URL**. Copy each one with its button and hand them to the lab before you close it. The secret is not shown again. The same dialog has **Download central certificate**, so you can take the certificate in the same step.

**Expected result:** the site is listed with an **active** badge. Its row menu offers **Rotate secret**, which issues a new secret, and **Revoke**, which deletes the client and marks the row revoked.

### Download central's certificate

If the lab must trust a self-signed central, give it central's public certificate. Select **Download central certificate** in the Sites page's **⋯** menu, or in the enrol dialog, to save `central-certificate.pem`. It comes from `GET /api/settings/sync/central-certificate`, for administrators only. It is central's public TLS certificate, not a secret. It needs `TLS_CERT_PATH` to point at central's certificate. The installer sets that and mounts the certificate for you.

### From the command line, on central

```bash
openldr sync enroll lab-site-01 --name "Regional Reference Lab" --central-url https://central.example.org
openldr sync list
openldr sync rotate lab-site-01
openldr sync revoke lab-site-01
```

`sync enroll` prints the client id, client secret, site id, central URL and OIDC issuer once, with a warning that the secret will not be shown again. `--central-url` is required. `sync list` shows enrolled sites and their status, never a secret. `sync rotate` prints a new secret once. `sync revoke` deletes the client and marks the row revoked, and is safe to run twice. Add `--json` to any of them for machine-readable output.

## Example 2: trust central's certificate on the lab

Skip this if central has a certificate the lab already trusts, such as one from Let's Encrypt for a real domain. It is needed when central uses a **self-signed** certificate: the installer default, and the usual case for a central on a LAN or a bare IP address.

**Why.** The lab's sync worker opens an HTTPS connection to central to get a token and to push and pull data. Node.js, which runs the lab server, checks central's certificate against its own trust store and refuses anything it does not trust, whatever the browser says. So sync fails until the lab trusts central's certificate.

1. Copy `central-certificate.pem` to the lab, for example to `config/nginx/certs/central/fullchain.pem` beside the lab's compose file.
2. Mount it read-only into the lab's `api` container, and set `NODE_EXTRA_CA_CERTS` to its path inside the container. In the lab's `docker-compose.yml`, under the `api` service:

   ```yaml
   volumes:
     - ./config/nginx/certs/central/fullchain.pem:/etc/ssl/central-ca.pem:ro
   ```

   and in the lab's `.env`:

   ```bash
   NODE_EXTRA_CA_CERTS=/etc/ssl/central-ca.pem
   ```

3. Recreate the lab API: `docker compose up -d api`.

**The certificate must match central's address.** TLS also checks that the certificate was issued for the address the lab connects to. If the lab reaches central by a bare IP, such as `https://10.0.0.5`, central's certificate must carry that IP as an **IP Subject Alternative Name**. A certificate that lists it only as a DNS name is refused with `ERR_TLS_CERT_ALTNAME_INVALID`. Make a new certificate with an IP SAN if needed:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout config/nginx/certs/privkey.pem -out config/nginx/certs/fullchain.pem \
  -subj "/CN=10.0.0.5" -addext "subjectAltName=IP:10.0.0.5,DNS:localhost,IP:127.0.0.1"
```

Then restart central's gateway with `docker compose restart gateway`, download the certificate again, and repeat the steps above on the lab.

## Example 3: connect the lab to central

The lab operator takes the five values from enrolment (client id, client secret, site id, central URL and OIDC issuer) and enters them on the lab's **Distributed sync** page.

1. On the lab, open **Settings**, then **Distributed sync**. It has two tabs: **Settings**, the configuration, and **Activity**, live status and the recent events. Stay on **Settings**.
2. Fill in the fields:

   | Field | Notes |
   | --- | --- |
   | Enable sync | The master switch. Off keeps both sync workers dormant. |
   | Direction | **Push** sends lab data up only. **Pull** receives configuration and terminology down only. **Bidirectional** does both. |
   | Central URL | Central's address from enrolment, for example `https://central.example.org`. |
   | Site ID | This lab's site id, for example `lab-site-01`. |
   | OIDC issuer URL | The realm issuer from enrolment, for example `https://central.example.org/auth/realms/openldr`. |
   | Client ID | The created client, `sync-<siteId>`. |
   | Client secret | The one-time secret from enrolment. Write-only and masked. Leave it blank when you edit other fields, to keep the stored value. |
   | Sync interval (minutes) | How often to sync, 1 to 1440. 15 by default. |

3. Select **Save**. With **Enable sync** on, the central URL, site id, OIDC issuer and client id are all required. Saving takes effect at once: switching sync on or off, changing direction or changing any field starts, stops or reconfigures the workers live, with **no restart**.

### Watch it sync

![Opening the Activity tab.](sync-activity.mp4)

Open the **Activity** tab. A status strip, refreshed every few seconds, shows:

- An **on** or **off** badge for the whole engine.
- A **push** and a **pull** line, each `running` or `idle`, with the last synced sequence and time. A direction the mode leaves out reads `not started`.
- **Pending push**: how many local changes still wait to go up.
- **Last checked** and **Last success**.

Below it, the **Recent activity** table lists each sync event newest first: direction, event (`synced`, `failed`, `quarantined` or `diverged`), record count, detail and time. Select a row for the full error and metadata. **Sync now** starts a pass straight away instead of waiting for the interval. It says whether a pass started, and does nothing while sync is off.

![The Activity tab on an install with sync off: not started, Pending push 0, Last checked never, and No sync activity yet.](sync-activity-tab.png)

**Expected result** with a live link: central lists the lab as **active** on Sites. On the lab, **Activity** shows the engine on, with the push and pull lines advancing and **Pending push** falling toward zero. Central's mirror gains the lab's records, stamped with its site id. The lab receives central's forms, dashboards, reports and terminology.

### From the command line, on the lab

```bash
openldr settings sync show
openldr settings sync set mode bidirectional
openldr sync status
openldr sync now
```

`settings sync set <field> <value>` writes one field: `enabled`, `mode`, `centralUrl`, `siteId`, `oidcIssuer`, `clientId`, `clientSecret` or `intervalMinutes`. `sync status` prints the live workers, cursors and pending backlog. `sync now` starts a pass, and fails if sync is off.

## On a phone

Both pages work on a phone. The Activity table scrolls sideways to reach each event's detail.

## Troubleshooting

- **Sync stays off, or nothing happens.** Check **Enable sync** is on and the direction is what you expect. Check the central URL, site id, OIDC issuer and client id. A blank secret field keeps the old value, so a wrong secret needs a fresh paste.
- **`503` "identity provider admin client is not configured" when enrolling, on central.** The API has no Keycloak admin service-account credentials. Set `KEYCLOAK_ADMIN_CLIENT_ID` and `KEYCLOAK_ADMIN_CLIENT_SECRET` in central's `.env` and recreate the API. The audit log stays empty, because enrolment writes its audit entry only after the client is created.
- **`403` when enrolling, on central.** The admin service account lacks `manage-clients` and `view-clients`. Import the central realm again, or add those two client roles by hand, then retry.
- **Enrolment fails with `fetch failed: connect ECONNREFUSED 127.0.0.1:443`, on central.** The API is trying to reach Keycloak at the public address, which inside the container is the API itself. Set `OIDC_INTERNAL_ISSUER_URL` to the in-cluster realm, for example `http://keycloak:8080/auth/realms/openldr`, so server-side token and admin calls use the internal address. Recreate the API.
- **Lab sync fails with `self-signed certificate`.** The lab does not trust central's certificate. See [Example 2](#example-2-trust-central-s-certificate-on-the-lab).
- **Lab sync fails with `ERR_TLS_CERT_ALTNAME_INVALID`.** The certificate is trusted but does not list the address the lab connects to. Make central's certificate with an IP Subject Alternative Name for that address, download it again and reinstall it on the lab.
- **Lost client secret.** It cannot be recovered, by design. Use **Rotate secret** on the site, from its row menu on Sites or with `openldr sync rotate <siteId>`, and paste the new secret on the lab's Settings tab.
- **Lab tokens refused at central.** The site was revoked, or the lab's client id or OIDC issuer does not match what central created. Check the site is active in `openldr sync list`, and that the issuer points at central's realm.
- **A revoked lab needs to come back.** Enroll the same site id again on central. It reactivates the row and issues a new secret.

## Related guides

- [Settings](/docs/settings)
- [Users and Roles](/docs/users)
- [Environment Variables](/docs/environment)
