# Getting started

OpenLDR Community Edition collects laboratory data from many sources, turns it into FHIR R4, and stores it in a database your organization controls. It then gives you dashboards, reports and surveillance views, with a strong focus on antimicrobial resistance (AMR). It is built for national and regional lab networks.

These pages cover installing, setting up and fixing an OpenLDR server. To learn the studio itself, open **Docs** inside the studio after you sign in.

## 1. Install

You need a host with Docker. Check [Requirements](/docs/requirements) first.

The one-line installer generates every secret, starts the stack on `https://localhost` with a self-signed certificate, and prints the URL and the admin credentials. All options are on the [Install](/docs/install) page.

Linux or macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

## 2. Sign in

1. Open the URL the installer printed.
2. Sign in with the admin credentials it printed.
3. Open **Docs** in the studio menu and read **Start here**.

To stop the stack, run `docker compose down` in the `openldr/` folder the installer made. To start it again, run `docker compose up -d` in the same folder.

## 3. Next steps

- [Load & push data](/docs/load-data): send your first lab data into OpenLDR.
- [Environment variables](/docs/environment): configure a deployment.
- [Authentication providers](/docs/auth-providers): sign in with Keycloak or another OpenID Connect provider.
- [Planned upgrades](/docs/upgrading): move to a new release safely.
- [Command-line interface (CLI)](/docs/cli): run OpenLDR from a terminal on a server with no browser.
- [Development](/docs/development): run OpenLDR from source.
