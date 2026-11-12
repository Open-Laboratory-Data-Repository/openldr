# Getting started

Install OpenLDR on a computer your organisation controls, then open Studio in a browser. OpenLDR receives laboratory data, converts it to FHIR R4, a standard format for healthcare data, and makes it available for dashboards and reports.

These web guides cover installation, server configuration and troubleshooting. The guides inside Studio explain how to use the app. You can use your own data throughout. Sample data is optional.

## Choose where OpenLDR will run

Choose the computer that will store your data and run OpenLDR. It needs to stay on while people use Studio. A laptop or phone opening Studio in a browser does not need its own OpenLDR installation.

| Your host | Where to start |
| --- | --- |
| Linux, macOS or Windows 10/11 | Read [Requirements](/docs/requirements), then follow [Install](/docs/install). |
| Windows Server | Follow [Windows Server](/docs/windows-server) to prepare a Linux environment, then install OpenLDR there. |
| A source checkout for development | Follow [Development](/docs/development). This uses workspace commands rather than the installed CLI. |
| An existing OpenLDR installation | Follow [Planned upgrades](/docs/upgrading). You do not need a new installation. |

## Install and check the result

The installer creates the configuration, generates passwords and starts the services. Run it on your chosen host.

1. Open the guide for your host above. Check its requirements before running commands.
2. Follow that guide's installation steps. Wait for the services to become ready.
3. Keep the address and the **Setup code** printed at the end. The setup code works for 30 minutes.

![Illustration of installer output. The highlighted lines show the address and the setup code. The code is a placeholder.](guide:install-result)

**Expected result:** The installer says **OpenLDR is ready** and prints the address to open. If it says **OpenLDR is starting**, some services are not ready yet. Inspect `docker compose ps` and `docker compose logs` from the installation folder before continuing.

The illustrated address is the default for a local installation. If you need access from other computers, configure a hostname with [Install](/docs/install). On another computer, `localhost` refers to that computer, not your OpenLDR host.

## First sign-in

Follow the illustrated sign-in tasks in [Install](/docs/install). A new local-sign-in install uses the setup code to create your first administrator. An installation using Keycloak uses its generated App sign-in credentials. Each path has screenshots for every step.

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
