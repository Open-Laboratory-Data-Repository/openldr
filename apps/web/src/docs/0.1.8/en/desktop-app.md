# Desktop app

The OpenLDR desktop app runs OpenLDR on one computer, in its own window. You need no Docker and no terminal. The app starts the bundled Postgres database and the OpenLDR server, shows Studio, and stops both when you quit. Inside it runs the same launcher as [Run without Docker](/docs/standalone), with the same data folder.

Packages exist for Linux x64, macOS on Apple silicon and Windows x64. Only Linux has been tried. The Windows and macOS packages are new. They are built on Linux, and nobody has run them on Windows or macOS yet.

## Install

The installer finds the newest OpenLDR release that has a package for your system. It downloads the package, checks it against the release's `SHA256SUMS` file, and puts the app in your own folders. It needs 2 GB free on the disk. Each package is about 500 to 600 MB, because Studio ships the pictures of its in-app guides. On a slow line the download takes some minutes.

### Linux and macOS

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash
```

To install one version, add it at the end: `| bash -s -- --version 0.1.12`.

### Windows

Run this in PowerShell. It needs no administrator rights.

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1 | iex
```

`irm | iex` passes no options. To install one version, use this form instead:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Version 0.1.12
```

The installer puts the app here:

| System | The app | How you start it |
| --- | --- | --- |
| Linux | `~/.local/share/openldr-desktop` | **OpenLDR** in the applications menu |
| macOS | `~/Applications/OpenLDR.app` | Launchpad, or open it in Finder |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR` | **OpenLDR** in the Start menu |

### The administrator password on Linux

The app shows Studio in a sandbox, which keeps web pages away from the rest of your computer. On Ubuntu 24.04 and later, the system does not let an app start that sandbox without an AppArmor profile. AppArmor is the part of Linux that limits what each program may do. In that case the installer installs a small profile with `sudo`, and asks for the administrator password once. It says so before it asks:

```text
→ This system does not let an app start its sandbox without an AppArmor profile.
→ This script will install a small profile for OpenLDR at /etc/apparmor.d/openldr-desktop-1000 with sudo, which asks for the administrator password once.
```

The number at the end of the file name is your user number. If you decline, nothing is installed, and the installer ends with `✗ The sandbox profile was not installed, so OpenLDR was not installed.` The installed app has no way to run with its sandbox off.

On a system without this rule, the installer asks for nothing. The rule is on when `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` holds `1`. An update asks again only when the profile has to change.

### The app is not signed

macOS and Windows can check who made a program before they open it. The OpenLDR app carries no publisher's signature on either system. Nobody has opened it on macOS or Windows yet, so this page does not say what they show.

On macOS the installer signs the app on your Mac with `codesign`, using a signature that names no publisher. Whether macOS then opens it is not proven.

## The first run

1. Start the app. The window shows **Starting OpenLDR** while the database and the server start.
2. Studio shows **Create the administrator**. The app fills in **Setup code**, and the hint under it says **Filled in by the OpenLDR app.**
3. Choose a username and a password, then select **Create the administrator**.
4. Three steps follow. Name the laboratory, load sample data, then see which setup checks still need you. You can skip the first two.

Studio's own guide, **First run**, covers the three steps. Sample data is offered only while the install holds no lab data. If you skip it, Settings, Setup checks can load it later, from its dots menu.

The app loads Studio at `http://127.0.0.1:3000/studio/`. It takes port 3000 when that port is free. If not, it picks another free port and remembers it. The address then stays the same while that port stays free.

The app fills in the setup code only for an OpenLDR it started itself. OpenLDR may already run when the app starts. You may have started it from a terminal. Or an app that was killed left it running. The app then shows that OpenLDR, and the setup code field stays empty.

The simple way out is to select **Quit** in the tray menu and start the app again. The app then starts OpenLDR itself and fills in the code. Or run the app's `openldr-standalone` command, and type the code it prints:

| System | Command |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone cli -- auth setup-code` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone cli -- auth setup-code` |
| Windows, in PowerShell | `& "$env:LOCALAPPDATA\Programs\OpenLDR\openldr-standalone.cmd" cli -- auth setup-code` |

## The window and the tray

Closing the window keeps OpenLDR running. To stop OpenLDR, use **Quit**.

The app has an icon in the system tray, the area of the taskbar or top bar that holds small icons for running programs. Its menu has four items:

| Item | What it does |
| --- | --- |
| **Open OpenLDR** | Shows the window again. |
| **Start when I sign in** | A tick, off at first. When it is on, the app starts when you sign in to the computer, with no window open. |
| **Open the log folder** | Opens `logs` in the data folder. |
| **Quit** | Shows **Stopping OpenLDR**, stops the server and the database, then closes the app. |

**Quit** stops OpenLDR even when the app showed an OpenLDR that it did not start itself.

Starting the app again while it runs brings its window back. Links that leave OpenLDR open in your browser. The app's own pages follow the system language: English, French or Portuguese.

### When no tray icon shows

Some Linux desktops show no tray icons. There, start the app again from the applications menu to bring its window back. To stop OpenLDR, press Alt in the window to show its menu bar, and use the quit item in its File menu. Or run `openldr-standalone stop` in a terminal.

## Update

Quit OpenLDR, then run the install line again. It replaces the app and leaves the data folder alone. The next start updates the database.

The installer refuses while OpenLDR runs, before it downloads anything. On Linux and macOS it says:

```text
✗ OpenLDR is running. Quit it from its tray icon, or run: "/home/you/.local/share/openldr-desktop/openldr-standalone" stop. Then run this again.
```

On Windows it says:

```text
X OpenLDR is running. Quit it from its tray icon, or run: & "C:\Users\you\AppData\Local\Programs\OpenLDR\openldr-standalone.cmd" stop. Then run this again.
```

The path in the message is the `openldr-standalone` command of your install. Quit OpenLDR from its tray icon, or run that `stop` line. Then run the install line again.

If the installer still refuses, a database from an OpenLDR that was killed may still be running. `stop` then says `OpenLDR is not running.`, because only the database is left. Start the app once and wait for Studio. When the app starts OpenLDR, OpenLDR first stops a database left running on the same data folder. Then select **Quit** in the tray menu, and run the install line again.

## Remove

Quit OpenLDR first. If the installer refuses with `OpenLDR is running.`, follow the steps under **Update**. On Linux and macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash -s -- --uninstall
```

On Windows:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Uninstall
```

This removes the app and the app's own `OpenLDR Desktop` folder. It also removes:

- on Linux, the menu entry, the start-at-sign-in entry, the `openldr-standalone` link in `~/.local/bin`, and the AppArmor profile, if one was installed, which asks for the administrator password again;
- on macOS, the `openldr-standalone` link in `~/.local/bin`;
- on Windows, the Start menu shortcut and the start-at-sign-in entry.

On macOS, if you set the app to start when you sign in, remove it from the login items in System Settings yourself.

The data folder stays. The last line says where it is, such as `Your data was left alone. It is in /home/you/.local/share/openldr`. To remove the data too, delete that folder yourself. It holds patient data.

## Where the data is

| System | Data folder | The app's own folder |
| --- | --- | --- |
| Linux | `~/.local/share/openldr`, or `$XDG_DATA_HOME/openldr` when `XDG_DATA_HOME` holds a full path | `~/.config/OpenLDR Desktop` |
| macOS | `~/Library/Application Support/OpenLDR` | `~/Library/Application Support/OpenLDR Desktop` |
| Windows | `%LOCALAPPDATA%\OpenLDR` | `%APPDATA%\OpenLDR Desktop` |

The data folder holds the database, stored files, the logs and the secrets key. [Run without Docker](/docs/standalone) lists what is in it. The app's own folder holds its settings, its log `desktop.log`, and the window's browser data. The settings are the port, start at sign-in and the window size. They hold no secret.

The data folder is the same one `openldr-standalone` uses. The app brings that command with it:

| System | The command |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone` |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR\openldr-standalone.cmd` |

On Linux and macOS the installer links it as `~/.local/bin/openldr-standalone` when that folder exists and is on your PATH. Then `openldr-standalone` works in a new terminal. On Windows nothing is added to your PATH, so run it by its full path.

It takes the commands on [Run without Docker](/docs/standalone), without `pnpm` in front: `openldr-standalone status`, `openldr-standalone stop` and `openldr-standalone cli -- doctor`. One launcher runs per data folder. If you start OpenLDR from a terminal first, the app shows that one.

## When it will not start

The app then shows **OpenLDR is not running**, the last message from OpenLDR, and **Try again**. Most errors also show **The logs are in:** with the log files. The log files are:

| File | Where |
| --- | --- |
| `server.log` | `logs` in the data folder |
| `postgres.log` | `logs` in the data folder |
| `desktop.log` | The app's own folder |

Read the message first, then the logs. `desktop.log` is the app's own log. It shows what the app did, and the events and error lines it got from OpenLDR.

| Message | What to do |
| --- | --- |
| `This data folder was last used by OpenLDR <newer>. This is OpenLDR <older>, which is older and cannot open it. Install OpenLDR <newer> or newer.` | Install that version or a newer one. See below. |
| `OpenLDR is not running. A recovery command is using the database (process <n>). Try again when it has finished.` | A command such as `openldr-standalone cli -- doctor` holds the data folder. Wait for it to end, then select **Try again**. |
| `OpenLDR did not answer when the app asked whether it is running.` | Select **Try again**. If it comes back, read `desktop.log`. |
| `OpenLDR stopped unexpectedly.` | Read `server.log` and `postgres.log`, then select **Try again**. |
| `OpenLDR is no longer running.` | Something stopped OpenLDR outside the app, such as `openldr-standalone stop` in a terminal. Select **Try again**. |
| `OpenLDR is not built. Build it, then start the app again.` | In an installed app this means its files are missing. Run the install line again. |

The data folder holds `last-version.json`, which names the version of OpenLDR that last started it. A newer version may change the database in a way an older one cannot read. So an older app refuses the folder with the first message above, and starts nothing.

Each start writes `last-version.json` just before the server starts, because the server may change the database even when it then fails. Removing the file lets the older app start. That is safe only when the newer version never changed the database. If you are not sure, assume it did. The older app then fails later with a database error. Installing the newer version is the safe way back.

On Windows, the bundled Postgres may need the Microsoft Visual C++ runtime, and the package does not include it. This is not confirmed yet.

## Limits

- This computer only. The app starts OpenLDR on `127.0.0.1`, so a phone or another computer cannot reach it. [Run without Docker](/docs/standalone) shows how to open OpenLDR to other devices.
- The app does not update itself. Run the install line again.
- The app carries no publisher's signature on macOS or Windows.
- The Windows and macOS packages are built on Linux, and nobody has run them yet.
- On macOS, the window may open when the app starts at sign-in. That is not proven.
- `desktop.log` grows without limit, like `server.log` and `postgres.log`. Delete it after you select **Quit**.
- The limits of [Run without Docker](/docs/standalone) apply too, such as no TLS and backup by copying the stopped data folder.

## Related guides

- [Run without Docker](/docs/standalone)
- [Install](/docs/install)
- [Getting started](/docs/getting-started)
- [CLI reference](/docs/cli)
