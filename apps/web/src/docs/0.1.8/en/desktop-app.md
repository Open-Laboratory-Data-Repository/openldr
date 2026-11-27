# Desktop app

The OpenLDR desktop app runs OpenLDR on one computer, in its own window. You need no Docker and no terminal. The app starts the bundled Postgres database and the OpenLDR server, shows Studio, and stops both when you quit. Inside it runs the same launcher as [Run without Docker](/docs/standalone), with the same data folder.

Packages exist for Linux x64, macOS on Apple silicon and Windows x64. They are built on Linux. On 2026-11-15, the operator reported successful runs on all three systems. The Reported tests section below gives the scope and the checks still outstanding.

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

macOS and Windows can check who made a program before they open it. The OpenLDR app carries no publisher's signature on either system. The operator opened it on both systems. The test record does not describe their security prompts.

On macOS the installer signs the app on your Mac with `codesign`, using a signature that names no publisher. On 2026-11-15, the operator reported that the app opened on a Mac mini after this step.

## The first run

1. Start the app. The window shows **Starting OpenLDR** while the database and the server start.
2. Studio shows **Create the administrator**. The app enters the code in **Setup code**, and the hint under it says **The OpenLDR app entered this code for you.**
3. Choose a username and a password, then select **Create the administrator**.
4. Three steps follow. You name your laboratory, load sample data, then review the setup checks that need attention. You can skip the first two.

Studio's own guide, **First run**, covers the three steps. Sample data adds 60 fictional lab orders, 39 of them with results, and an example dashboard. No action removes only the sample orders later, and Factory reset leaves them in place. Only erasing all your data removes them, for example by deleting the data folder. Sample data is offered only while the install holds no lab data. If you skip it, you can load it later from the dots menu under Settings → Setup checks.

The app loads Studio at `http://127.0.0.1:3000/studio/`. It takes port 3000 when that port is free. If not, it picks another free port and remembers it. The address then stays the same while that port stays free.

The app enters the setup code only for an OpenLDR it started itself. OpenLDR may already run when the app starts. You may have started it from a terminal. Or an app that was killed left it running. The app then shows that OpenLDR, and the setup code field stays empty. The hint under it says **Select Quit in the tray menu, then open OpenLDR again. The app will enter the code for you.**

The simple way out is to select **Quit** in the tray menu and start the app again. The app then starts OpenLDR itself and enters the code. Or run the app's `openldr-standalone` command, and type the code it prints:

| System | Command |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone cli -- auth setup-code` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone cli -- auth setup-code` |
| Windows, in PowerShell | `& "$env:LOCALAPPDATA\Programs\OpenLDR\openldr-standalone.cmd" cli -- auth setup-code` |

## The window and the tray

Closing the window keeps OpenLDR running. To stop OpenLDR, use **Quit**.

The app has an icon in the system tray, the area of the taskbar or top bar that holds small icons for running programs. Its menu has seven items, and more while OpenLDR is shared:

| Item | What it does |
| --- | --- |
| **Open OpenLDR** | Shows the window again. |
| **Start when I sign in** | A tick, off at first. When it is on, the app starts when you sign in to the computer, with no window open. |
| **Share on the lab network** | A tick, off at first. See **Share on the lab network** below. |
| **Connect to a lab server...** | Asks, then restarts the app as a screen onto another PC. See **Connect to the lab's server** below. |
| **Lock this PC to OpenLDR...** | Asks for a PIN and locks this PC to OpenLDR. See **Lock this PC to OpenLDR** below. |
| **Open the log folder** | Opens `logs` in the data folder. |
| **Quit** | Shows **Stopping OpenLDR**, stops the server and the database, then closes the app. |

**Quit** stops OpenLDR even when the app showed an OpenLDR that it did not start itself.

Starting the app again while it runs brings its window back. Links that leave OpenLDR open in your browser. The app's own pages follow the system language: English, French or Portuguese.

### Share on the lab network

Tick **Share on the lab network** to let other PCs in the lab open this OpenLDR. The app asks first. OpenLDR then restarts, and anyone using it waits a moment.

While it is shared, the tray menu also shows the address other PCs use, and three more items. The menu shows one address. If it does not open on another PC, run `openldr-standalone status --json` in a terminal and try the other addresses under `share.addresses`. **Where the data is** below gives the command's full path, which Windows needs.

| Item | What it does |
| --- | --- |
| **Copy network address** | Copies the `https` address to give to the other PCs. |
| **Copy certificate fingerprint** | Copies the fingerprint to compare on the other PC. |
| **Save certificate...** | Saves the certificate as a file, for a program that needs it. |

On another PC, open the address in a browser. The browser warns about the certificate the first time. Compare its SHA-256 fingerprint with the one from the tray, and accept it only when they match.

Other PCs use port 3443. If another program uses that port, the app shows `Port 3443 is already in use. Choose another with --share-port.` To use another port, quit the app, add `"sharePort": 8443` to `settings.json`, and start it again. The file is in the app's own folder, `OpenLDR Desktop`. **Where the data is** below gives its place on each system.

If OpenLDR was started outside the app, the tick is saved and applies the next time the app starts it. [Run without Docker](/docs/standalone) has more on the certificate.

### When no tray icon shows

Some Linux desktops show no tray icons. There, start the app again from the applications menu to bring its window back. To stop OpenLDR, press Alt in the window to show its menu bar, and use the quit item in its File menu. Or run `openldr-standalone stop` in a terminal.

## Connect to the lab's server

A lab needs one OpenLDR. On every other PC, the app can show that OpenLDR instead of running its own. The PC then runs no server and no database, and holds no data. [Choose a lab setup](/docs/lab-setups) says when to use this.

### Choose it on the first start

On a PC with no OpenLDR data, the app asks **How will this PC use OpenLDR?** before it starts anything.

1. Select **Connect to the lab's server**.
2. In **Server address**, type the address of the lab's OpenLDR, such as `https://labpc:3443/studio/`. For a shared desktop app, that is the address its tray menu shows.
3. Select **Connect**.
4. If the app shows **Check the server's certificate**, compare the fingerprint. See the next section.

Studio then opens from the server. Sign in with your OpenLDR username and password. The app remembers the address and goes straight to it at the next start.

The address must start with `https`. A PC that already holds OpenLDR data is not asked. It stays as it is.

The app enters no setup code in this mode. Create the first administrator on the server itself.

### Check the server's certificate

A shared desktop app makes its own certificate, so the system on your PC does not know it. The app then shows the certificate's SHA-256 fingerprint and asks.

1. On the server, open the tray menu and select **Copy certificate fingerprint**. With the launcher, read the line `Certificate fingerprint (SHA-256):` in its terminal.
2. Compare it with the fingerprint in the app, pair by pair.
3. Select **It matches** only when they are the same. Otherwise select **Cancel**.

The app remembers that certificate for that address only. A server whose certificate your system already trusts is not asked about.

If the app later shows **The server's certificate has changed**, stop and find out why. A new name or network address for the server makes a new certificate. If nobody changed the server, select **Cancel**. After **It matches**, the app closes and opens again by itself.

### When the server does not answer

At the start, the app shows **Cannot reach the server** when the server is off or the network is down. It tries again every 10 seconds and shows Studio by itself once the server answers. **Try again** tries at once.

While you work, the app never replaces Studio by itself. If the server goes off, Studio stays on screen with what you typed, and its own requests fail until the server is back.

### Change the server or the mode

In this mode the tray menu has these items:

| Item | What it does |
| --- | --- |
| **Open OpenLDR** | Shows the window again. |
| **Start when I sign in** | Starts the app when you sign in to the computer. |
| The server's address | A line you cannot press. |
| **Change server...** | Forgets the server and asks for another address. |
| **Use this PC for the lab's data...** | Asks, then restarts the app so OpenLDR and its database run on this PC. |
| **Lock this PC to OpenLDR...** | See **Lock this PC to OpenLDR** below. |
| **Open the log folder** | Opens the app's own folder, which holds `desktop.log`. |
| **Quit** | Closes the app. The server keeps running. |

**Change server** is also a button on the **Cannot reach the server** screen. After you connect to another server, the app may close and open again by itself.

A PC that holds the lab's data has **Connect to a lab server...** in its tray menu. It asks, stops OpenLDR on this PC, and restarts the app as a screen onto another PC. The data on this PC stays where it is and is not used.

## Lock this PC to OpenLDR

In a shared room, a PC can be set to show OpenLDR and nothing else. The lock works in both modes.

### Turn the lock on

1. Open the tray menu and select **Lock this PC to OpenLDR...**.
2. Type a PIN of at least 4 characters.
3. Select **Lock**.

The window then fills the screen. While the PC is locked:

- Closing the window does nothing.
- Links to other sites do not open.
- The app starts when you sign in to the computer.
- The tray menu has three items: **Open OpenLDR**, **Unlock this PC...** and **Quit**.
- **Quit** asks for the PIN, from the tray, the menu and the keyboard.

### Unlock

Press `Ctrl+Shift+L` in the window, or select **Unlock this PC...** in the tray menu. Type the PIN and select **Unlock**. A small window on top asks for the PIN, so what you typed in Studio stays. A wrong PIN is refused after two seconds.

### What the lock does not stop

The lock stops a casual user. It does not stop these:

- The operating system's own keys, such as Alt+Tab or the Windows key. Blocking them is the system's job.
- Shutting down or signing out of the PC. The app then quits with no PIN, so OpenLDR stops cleanly.
- Someone who can edit files with the PC's account. They can remove the lock from the settings file.

To close those gaps on Windows, run the app as the kiosk program of a separate Windows account. For a desktop program this is the Shell Launcher feature in Windows Enterprise and Education, or a kiosk profile that lists `%LOCALAPPDATA%\Programs\OpenLDR\OpenLDR.exe`. Microsoft's guide "Configure kiosks and digital signs on Windows" has the steps. We have not tested this.

### A forgotten PIN

1. Open `settings.json` in the app's own folder with a text editor. **Where the data is** below gives its place.
2. Remove the whole `"lock"` entry and save the file.
3. In the app's window, press `Ctrl+Shift+L`.

The app unlocks with no PIN once the entry is gone. To reach the file from a locked PC, use the system's own keys to open a file window, or sign out and sign in with another account that can reach it.

## Update

Quit OpenLDR, then run the install line again. It replaces the app and leaves the data folder alone. The next start updates the database.

The installer refuses while OpenLDR runs, before it downloads anything. On Linux and macOS it says:

```text
✗ OpenLDR is running. Quit it from its tray icon, then run this again. Or stop it with: "/home/you/.local/share/openldr-desktop/openldr-standalone" stop
```

On Windows it says:

```text
X OpenLDR is running. Quit it from its tray icon, then run this again. Or stop it with: & "C:\Users\you\AppData\Local\Programs\OpenLDR\openldr-standalone.cmd" stop
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

The data folder holds the database, stored files, the logs and the secrets key. [Run without Docker](/docs/standalone) lists what is in it. The app's own folder holds its settings, its log `desktop.log`, and the window's browser data. The settings are the port, start at sign-in, the window size, whether OpenLDR is shared on the lab network, and the port for sharing when you set one. In connect mode they also hold the server's address and the fingerprint of the certificate you accepted. A locked PC adds the lock, kept as a salted hash of the PIN. They hold no password and no key.

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
| `OpenLDR did not respond to a status check.` | Select **Try again**. If it comes back, read `desktop.log`. |
| `OpenLDR stopped unexpectedly.` | Read `server.log` and `postgres.log`, then select **Try again**. |
| `OpenLDR is no longer running.` | Something stopped OpenLDR outside the app, such as `openldr-standalone stop` in a terminal. Select **Try again**. |
| `OpenLDR is not built. Build it, then start the app again.` | In an installed app this means its files are missing. Run the install line again. |

The data folder holds `last-version.json`, which names the version of OpenLDR that last started it. A newer version may change the database in a way an older one cannot read. So an older app refuses the folder with the first message above, and starts nothing.

Each start writes `last-version.json` just before the server starts, because the server may change the database even when it then fails. Removing the file lets the older app start. That is safe only when the newer version never changed the database. If you are not sure, assume it did. The older app then fails later with a database error. Installing the newer version is the safe way back.

On Windows, the bundled Postgres may need the Microsoft Visual C++ runtime, and the package does not include it. This is not confirmed yet.

## Reported tests

These are operator reports from 2026-11-15, using packages built from `90caabca`. They do not prove every platform check passed.

- Linux: installation, automatic setup-code entry, the first-run steps and loading 60 sample orders into the dashboard.
- Windows: installation, removal, the tray icon, automatic setup-code entry, first run with 60 orders, quitting from the tray and bringing back the existing window on a second launch.
- macOS on a Mac mini: the operator reported that the app opened and ran. The record does not identify every step tried.

Still unreported:

- Windows: refusal to update while running, launcher status, ending the app from Task Manager, and starting without the Visual C++ runtime.
- macOS: window selection while another Electron app runs, the Dock icon, startup at sign-in and what removal leaves behind.
- All three systems: shutdown and sign-out while OpenLDR runs.

## Limits

- This computer only, unless **Share on the lab network** is ticked. The app starts OpenLDR on `127.0.0.1`. Sharing opens a second, encrypted port for other PCs on the lab network.
- The app does not update itself. Run the install line again.
- The app carries no publisher's signature on macOS or Windows.
- On macOS, the window may open when the app starts at sign-in. That is not proven.
- `desktop.log` grows without limit, like `server.log` and `postgres.log`. Delete it after you select **Quit**.
- The limits of [Run without Docker](/docs/standalone) apply too, such as backup by copying the stopped data folder.

## Related guides

- [Choose a lab setup](/docs/lab-setups)
- [Using Studio](/docs/using-studio)
- [Run without Docker](/docs/standalone)
- [Install](/docs/install)
- [Getting started](/docs/getting-started)
- [CLI reference](/docs/cli)
