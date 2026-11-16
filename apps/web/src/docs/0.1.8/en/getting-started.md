# Getting started

OpenLDR receives laboratory data and makes it available for dashboards and reports. It is free. Every tier includes the same application features. Choose the path that matches what you need to do.

## Start with the desktop app

Choose the desktop app to run OpenLDR on one computer. It includes its own database and needs no Docker containers. Packages are available for Linux x64, Windows x64 and macOS on Apple silicon.

1. Follow the [Desktop app guide](/docs/desktop-app) for your system.
2. Open OpenLDR from your computer's applications menu.
3. Create the first administrator, then follow the first-run steps in Studio. Sample data is optional.
4. Continue with [Using Studio](/docs/using-studio) to find the guides for your daily work.

The installer currently needs one terminal command. The desktop guide gives the command for your system. After installation, use OpenLDR from its own window.

## Use your laboratory's installation

If your laboratory already runs OpenLDR, ask its administrator for the Studio address and your account. Open that address in a browser on your computer or phone.

You do not need another installation. [Using Studio](/docs/using-studio) explains where to find the user guides after signing in.

## Run a shared server

This path is for the person setting up and maintaining OpenLDR for other people. Users connect to Studio in a browser. The server uses Docker containers.

Start with [Server requirements](/docs/requirements), then follow [Install](/docs/install). On Windows Server, prepare the Linux environment in [Windows Server](/docs/windows-server) first.

For maintenance, use [Planned upgrades](/docs/upgrading), [Environment variables](/docs/environment) and [Authentication providers](/docs/auth-providers). The detailed terminal instructions remain in those guides.

## Use command-line tools or work on the code

Use these guides when you need to automate tasks, run operator commands or develop OpenLDR:

- [CLI sign-in and access keys](/docs/cli-access) explains access for people and scripts.
- [Command-line interface](/docs/cli) lists commands and operator tasks.
- [Run without Docker](/docs/standalone) builds and runs the standalone launcher from source.
- [Development](/docs/development) sets up a separate development checkout.

## Enterprise status

Enterprise is based on Server, with a deployment intended for multiple machines, load balancing and redundant backups. It remains in development and testing. There is no Enterprise installer yet. Use [Server installation](/docs/install) for the available shared deployment.
