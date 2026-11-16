# Getting started

Install OpenLDR on a computer your organisation controls. Use the desktop app or open Studio in a browser. OpenLDR receives laboratory data, converts it to FHIR R4, a standard format for healthcare data, and makes it available for dashboards and reports.

These web guides cover installation, server configuration and troubleshooting. The guides inside Studio explain how to use the app. You can use your own data throughout. Sample data is optional.

## Choose where OpenLDR will run

Choose the computer that will store your data and run OpenLDR. It needs to stay on while people use Studio. A phone or another computer opening Studio in a browser does not need its own installation.

OpenLDR is free in every tier. The tiers describe how you run the software.

| Tier | How it runs | Where to start |
| --- | --- | --- |
| Standalone | One computer, with bundled PostgreSQL and files in a local folder. No Docker containers. | [Desktop app](/docs/desktop-app) installs it on Linux x64, Windows x64 or macOS on Apple silicon. Developers can [build the standalone launcher](/docs/standalone) from source. |
| Server | A shared server with Docker containers, PostgreSQL and S3-compatible file storage. Local accounts are the default; Keycloak is optional. | Read the [Server requirements](/docs/requirements), then follow [Install](/docs/install). On Windows Server, prepare the Linux environment in [Windows Server](/docs/windows-server) first. |
| Enterprise | A deployment based on Server, intended for multiple machines, load balancing and redundant backups. | Still in development and testing. There is no Enterprise installer yet. Use [Server installation](/docs/install) for the available shared deployment. |

A [source checkout for development](/docs/development) uses workspace commands. For an existing Server installation, follow [Planned upgrades](/docs/upgrading). For an existing desktop installation, use the update steps in [Desktop app](/docs/desktop-app).

## Install and check the result

Follow the guide for your chosen tier.

1. For Standalone, install and open the [desktop app](/docs/desktop-app). It starts the database and server, then shows Studio in its window.
2. For Server, follow [Install](/docs/install). The installer creates the configuration, generates passwords and starts the containers.
3. Keep the data folder and follow your guide's backup instructions.

The illustration below shows the **Server installer**. It does not describe desktop startup.

![Illustration of installer output. The highlighted lines show the Server address and setup code. The code is a placeholder.](guide:install-result)

**Expected result:** The desktop app shows Studio. The Server installer says **OpenLDR is ready** and prints the address to open. If the Server installer says **OpenLDR is starting**, inspect `docker compose ps` and `docker compose logs` from its installation folder before continuing.

The desktop app opens only on its own computer by default. For a shared Server installation, configure a hostname with [Install](/docs/install). On another device, `localhost` refers to that device.

## First sign-in

The desktop app enters the setup code for an OpenLDR it starts itself. Choose the first administrator's username and password, then follow Studio's first-run steps. [Desktop app](/docs/desktop-app) explains what to do if the code field is empty.

For Server or the source-built standalone launcher, enter the setup code printed in the terminal. It works for 30 minutes. [Install](/docs/install) shows each administrator-creation screen. A Server installation using Keycloak uses its generated App sign-in credentials instead.

## Continue in the app

Open **Docs** in Studio's main menu and read **Start here**. It explains the installed and development CLI, then links to the illustrated user guides.

Facilities, Test catalog and patient settings are optional. OpenLDR can receive and process data before you complete them. We recommend setting them up as you use the system. The in-app **Set up your system** guides start with Terminology.

Use the dashboard and report guides for daily work. They work with your own data; practice files are optional.

## Choose your next task

- [Load & push data](/docs/load-data): bring your first laboratory data into OpenLDR.
- [Command-line interface](/docs/cli): run operator commands on the OpenLDR host.
- [Authentication providers](/docs/auth-providers): configure who can sign in.
- [Environment variables](/docs/environment): change server configuration.
- [Planned upgrades](/docs/upgrading): prepare a backup and move to a new release.
