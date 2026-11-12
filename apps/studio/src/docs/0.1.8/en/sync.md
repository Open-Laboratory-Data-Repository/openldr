# Distributed sync

Distributed sync links a lab installation to a central OpenLDR installation. The lab pushes its clinical records. Central supplies shared configuration and terminology for the lab to read.

You need **View sync** to read status and events. **Manage sync** permits configuration, site management and divergence decisions. Central enrolls labs under Settings, Sites. A lab configures its link under Settings, Distributed sync.

For a live link, obtain the site id, central URL, OIDC issuer, client id and one-time client secret through central enrollment. Central enrollment requires Keycloak client administration. Keep these values private and use HTTPS.

The pictures show the real settings and a deliberately unavailable local central. The examples verify configuration and failure inspection. They do not show a successful lab-to-central transfer or invent enrollment credentials. No documentation sample data is required.

## Check central enrollment is available

The central administrator must enroll the lab before its operator can configure a real link.

### 1. Open Sites on central

Open **Settings**, then **Sites**.

![Central manages enrolled labs under Settings, Sites.](sync-guide-sites.png)

### 2. Check provider administration

Enrollment requires Keycloak client administration. This isolated installation reports that it is unavailable, so it cannot issue a real client secret. Configure the central identity service before proceeding with a live setup.

![This isolated installation has no provider client administration, so enrollment is unavailable.](sync-guide-admin-unavailable.png)

**Expected result:** A configured central offers Enroll site. The example stops before enrollment because provider client administration is unavailable.

## Enter the enrollment values on the lab

Use the values issued by your central administrator. The screenshot values point only to a nonexistent local test service.

### 1. Open Distributed sync

On the lab, open **Settings**, then **Distributed sync**.

![A lab configures its link under Settings, Distributed sync.](sync-guide-open.png)

### 2. Choose Settings

Stay on the **Settings** tab.

![Stay on the Settings tab to configure the lab.](sync-guide-settings.png)

### 3. Check Enable sync

Keep **Enable sync** off while entering the enrollment values. Turn it on when they are ready. Off leaves both workers dormant.

![Enable sync controls whether the push and pull workers run.](sync-guide-enabled.png)

### 4. Choose Direction

Use Push to central for lab data only, Pull from central for shared configuration only, or **Bidirectional** for both.

![Choose Push to central, Pull from central or Bidirectional.](sync-guide-direction.png)

### 5. Enter Central URL

Use the public HTTPS address supplied at enrollment. The picture uses an absent local HTTP test address and is not a production configuration.

![Use the reachable central address from enrollment. This picture uses an absent local test address.](sync-guide-central.png)

### 6. Enter Site ID

Use the stable site identifier assigned by central. Do not invent another id for an enrolled client.

![Use the exact enrolled site id.](sync-guide-site.png)

## Enter the site credentials and save

Continue in the Sync Settings tab. Use credentials supplied for this lab by central. Leave an existing secret blank only when keeping it.

### 1. Enter issuer and client id

Copy **OIDC issuer URL** and **Client ID** exactly from central enrollment.

![Use the OIDC issuer and client id supplied by central.](sync-guide-issuer.png)

### 2. Enter the one-time secret

Fill **Client secret**. The field is masked and write-only. The screenshot contains a fictional value that cannot authenticate.

![Enter the one-time secret. It remains masked. This is a fictional unusable value.](sync-guide-secret.png)

### 3. Set the interval

Choose **Sync interval (minutes)** between 1 and 1440. The default is 15.

![Choose a sync interval between 1 and 1440 minutes.](sync-guide-interval.png)

### 4. Open the tab actions

Turn Enable sync on when ready, then open the tab-strip dots.

![The tab-strip dots contain Save.](sync-guide-actions.png)

### 5. Save the configuration

Select **Save**. Changes start, stop or reconfigure workers immediately, without an API restart.

![Save applies the configuration without restarting the API.](sync-guide-save.png)

**Expected result:** A valid link can authenticate and transfer data. A save notification proves the settings were accepted, not that central was reached.

## Read live sync activity

Use Activity to establish whether the saved link actually works.

### 1. Open Activity

Select the **Activity** tab. Read push and pull state, Pending push, Last checked and Last success.

![Activity shows the live worker state and events.](sync-guide-activity.png)

### 2. Request a pass

Open the tab dots and choose **Sync now** to request an immediate pass. It does not run a pass while sync is off.

![Sync now asks for a pass immediately.](sync-guide-now.png)

### 3. Read the event row

Read event, direction, record count and detail. This example records a real failure because its local central does not exist.

![The absent local central produces a real failed event, not a successful link.](sync-guide-failed-row.png)

### 4. Open the event

Select its row to open the **Sync event** sheet.

![Open an event to read its full error and metadata.](sync-guide-detail.png)

### 5. Read the full error

Read the error and metadata. Correct the specific connection, identity or data issue before retrying.

![Read the actual network failure before changing settings.](sync-guide-error.png)

**Expected result:** A successful live link shows successful events, advancing cursors and a falling pending backlog. The example establishes failure visibility only.

## Stop sync and edit safely

Use the master switch to pause both workers without removing the saved connection values.

### 1. Save with Enable sync off

Close the event, return to Settings, switch Enable sync off, then open the dots and Save.

![Save with Enable sync off stops both workers.](sync-guide-disable-save.png)

### 2. Keep the stored secret when editing

Reopen or reload Settings. The secret remains blank with its stored-secret placeholder. Leave it blank to keep it when changing other fields.

![A saved secret stays blank when editing other fields.](sync-guide-secret-kept.png)

**Expected result:** Both workers stop. The fictional test link remains disabled after the demonstration.

## Use sync settings on a phone

The settings form scrolls vertically at phone width. Wide event tables can scroll within their own pane.

### 1. Read the connection fields

Open Distributed sync, Settings and scroll to the required field.

![The settings fields stack at phone width.](sync-guide-phone-settings.png)

### 2. Check Activity

Use Activity for current state and events. Open a row for its complete detail.

![Activity remains available on a phone.](sync-guide-phone-activity.png)

## What central enrollment supplies

On a central with Keycloak client administration configured, open Sites, then its dots and Enroll site. Supply a stable lowercase Site ID, an optional Name and the public Central URL. Enrollment creates a client named sync-<siteId> and its site_id token mapping.

The enrollment result shows client id, client secret, OIDC issuer and central URL. Copy the secret privately before closing. It appears only once. A lost secret requires Rotate secret on that site row and an update on the lab. Revoke deletes the client and marks the site revoked.

The central service account needs manage-clients and view-clients in the Keycloak realm. These operations were not exercised in the isolated test installation. Its identity administration is intentionally disabled.

## Trust central TLS on the lab server

A browser accepting a self-signed certificate does not make the lab server trust it. Download central's public certificate from the Sites dots or enrollment result, then transfer it to the lab through your normal administration channel.

Mount it read-only into the lab API container and set NODE_EXTRA_CA_CERTS to that container path. Recreate the lab API after changing its environment. The certificate must match the central hostname or IP address, including its Subject Alternative Name. Keep normal certificate validation enabled.

Use a trusted HTTPS central address in production. A localhost HTTP address is useful only for isolated tests like the illustrated setup. No certificate download or TLS trust change was exercised here.

## Use the CLI

Follow [Start here](/docs/start-here) for CLI setup. From `openldr_ce`, central uses sync enroll, list, rotate and revoke. These credentials are real secrets. Do not put their output in shared logs or screenshots.

On the lab, settings sync show masks the stored secret. Set one field at a time with settings sync set. Sync status and sync now inspect or request live work.

```shell
pnpm openldr settings sync show
pnpm openldr sync status
pnpm openldr sync now
pnpm openldr settings sync set enabled false
```

## Troubleshooting

**Enrollment is unavailable.** Check central Keycloak administration capabilities and its service-account roles. Generic OIDC does not provision sync clients.

**Authentication fails.** Match site id, issuer, client id and current secret to central enrollment. Rotate a lost secret, then update the lab.

**Certificate error.** Check trust on the lab API server and certificate address matching. The browser's exception does not configure the server.

**Activity contains failed, quarantined or diverged events.** Open the event and read its full reason. Do not treat every failure as a network problem. Resolve the reported condition before repeating changes.

**Pending push remains high.** Read Last success and recent failures. Sync now requests a pass but does not prove it succeeded.

## Related guides

[Authentication providers](/docs/auth-providers), [Environment variables](/docs/environment) and [Settings](/docs/settings).
