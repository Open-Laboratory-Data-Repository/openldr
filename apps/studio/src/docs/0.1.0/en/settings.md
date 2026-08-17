# Settings

Settings is an administrator-only routing area for supported configuration pages documented in this in-app manual.

Use [Roles](/docs/roles) to build capability-based roles and see the built-in system roles.

Use [Distributed Sync](/docs/sync) to link a lab to a central server — configure the connection and direction on its **Settings** tab, and watch live status and the recent-activity log on its **Activity** tab.

Use [Connectors](/docs/connectors) to configure external destinations and plugin-backed integrations.

Use [Marketplace](/docs/marketplace) to browse installable artifacts, manage registries, and review installed packages.

See [Environment Variables](/docs/environment) for the deployment-level configuration read at startup (public address, TLS, database, storage, and secrets).

This manual documents supported settings areas only. If a settings page is not covered here, treat it as outside the current in-app documentation scope.

## Update checks

**Settings → General** shows the version this install is running, and — when one exists — the
newer version that has been published, with the two commands to upgrade.

The check is **on by default**. It fetches a small file from GitHub once a day, with a
10-second timeout on that one request, and compares version numbers. It never downloads an
image and never restarts anything; upgrading is always something you do yourself.

**What the check sends:** nothing but an ordinary web request for a public file. No site name,
no version, no identifier. As with any web request, the server that answers it can see your
network's IP address and the time you asked.

**To turn it off,** switch off *Check for updates* in **Settings → General**. The install then
makes no outbound request at all, and the version line shows only what you are running. An
air-gapped lab can leave it on — a failed check is silent, and the last known answer is kept.
There is no command-line switch for this; it is a Studio-only setting.

**From the command line:** `openldr update check` prints the same information. It exits **0** when
the install is up to date, **1** when an update is available, and **2** when the check itself
failed. Exit 1 means "an update exists", not an error, so a script can act on it directly — and a
failed run exits 2, so a broken check never looks like a new release.

## Related guides

- [Roles](/docs/roles)
- [Distributed Sync](/docs/sync)
- [Connectors](/docs/connectors)
- [Marketplace](/docs/marketplace)
- [Environment Variables](/docs/environment)
