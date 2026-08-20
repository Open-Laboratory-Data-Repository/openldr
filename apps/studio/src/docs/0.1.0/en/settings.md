# Settings

Settings is an administrator-only routing area for supported configuration pages documented in this in-app manual.

Use [Roles](/docs/roles) to build capability-based roles and see the built-in system roles.

Use [Distributed Sync](/docs/sync) to link a lab to a central server — configure the connection and direction on its **Settings** tab, and watch live status and the recent-activity log on its **Activity** tab.

Use [Connectors](/docs/connectors) to configure external destinations and plugin-backed integrations.

Use [Marketplace](/docs/marketplace) to browse installable artifacts, manage registries, and review installed packages.

See [Environment Variables](/docs/environment) for the deployment-level configuration read at startup (public address, TLS, database, storage, and secrets).

This manual documents supported settings areas only. If a settings page is not covered here, treat it as outside the current in-app documentation scope.

## Update checks

**Settings → General** shows the version this install is running and, on the line below it, where
that version stands. That line reads one of six ways: the version number and *up to date*; *no
update found*; a newer version with its release date and notes, followed by the two commands to
upgrade; *update check is off*; *cannot confirm*, when the last check failed or the running version
could not be read; or *not checked yet*.

*No update found* means the last successful check saw an **older** release than the one you are
running, so it has nothing to tell you. **No version number is shown in this case, on purpose.** A
number lower than the one you are running is not something to act on, and reading it as an
instruction to downgrade would be wrong. Use *Last checked* underneath to see how old the answer is.

This happens when you upgrade shortly after a release, because the check runs once a day and the
answer it cached predates your own version. It corrects itself at the next check, or immediately if
you restart the api container.

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
