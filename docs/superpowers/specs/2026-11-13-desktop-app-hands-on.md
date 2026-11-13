# Desktop app: the hands-on list

Everything here needs a person: the administrator password on the Linux box, the Windows laptop,
the Mac mini, or eyes on a screen. The build did not wait for any of it. Do the steps in this
order. Each step has the line to paste and what to tell the builder.

Design: `2026-11-13-desktop-app-design.md`. Built on the branch `claude/desktop-app-af24b7`.

## What is proven and what is not

- Linux, this machine: the app starts, shows Studio, hands the setup code over, attaches, quits
  and installs. Every run so far used `--no-sandbox`, because the sandbox profile needs your
  password. Step 1 below is the real proof.
- Windows and macOS: nothing has been run. The packages were built on Linux and checked by
  listing what is inside them. `install/desktop.ps1` has never been run by anyone.

## Before you start: serve the packages

The three packages and the two install scripts are in `dist/desktop` in the worktree. Git ignores
that folder. They are not under the temp folder, so a reboot keeps them.

On the Linux box, in a terminal:

```bash
cd ~/Projects/Repositories/openldr_ce/.claude/worktrees/desktop-app-af24b7 && python3 -m http.server 3996 --bind "$(tailscale ip -4)" --directory dist/desktop
```

It serves that one folder to the tailnet only, on port 3996. Leave it running while you work on
the laptop and the Mac. Stop it with Ctrl+C when you are done. Nothing else was left running.

The Linux box's tailnet address is `100.107.125.94`. The lines below use it.

## 1. Linux: the sandbox profile (needs your password once)

This is the one thing Linux still lacks. It installs the app for real, into
`~/.local/share/openldr-desktop`, with a small AppArmor profile so the sandbox can start.

Install, from your own terminal on the Linux box:

```bash
OPENLDR_DESKTOP_DOWNLOAD_BASE="file://$HOME/Projects/Repositories/openldr_ce/.claude/worktrees/desktop-app-af24b7/dist/desktop" bash "$HOME/Projects/Repositories/openldr_ce/.claude/worktrees/desktop-app-af24b7/install/desktop.sh" --version 0.1.11
```

It says what it is about to do, then `sudo` asks for your password. It runs two commands as
root: it loads the profile, then copies it to `/etc/apparmor.d/openldr-desktop-<your user number>`.

The check, with the sandbox on. It uses a temp data folder, so your real install in
`~/.local/share/openldr` is not touched:

```bash
mkdir -p /tmp/openldr-try && OPENLDR_DESKTOP_DATA_DIR=/tmp/openldr-try/data OPENLDR_DESKTOP_USER_DIR=/tmp/openldr-try/app OPENLDR_DESKTOP_PORT=3990 OPENLDR_DESKTOP_SELFCHECK=/tmp/openldr-try/check.json ~/.local/share/openldr-desktop/openldr-desktop; echo "exit=$?"; cat /tmp/openldr-try/check.json
```

A window opens for some seconds and closes by itself.

- It worked if the last lines are `exit=0` and a line holding `"setupPage":true`.
- It did not work if it ends within two seconds with `exit=133` and a line about the sandbox.
  That is what happens today without the profile.

Then try it by hand, still on the temp data folder (leave the self-check out):

```bash
OPENLDR_DESKTOP_DATA_DIR=/tmp/openldr-try/data OPENLDR_DESKTOP_USER_DIR=/tmp/openldr-try/app OPENLDR_DESKTOP_PORT=3990 ~/.local/share/openldr-desktop/openldr-desktop
```

Work through the checklist in section 4.

Careful: started from the applications menu, the installed app uses OpenLDR's default data
folder, `~/.local/share/openldr`. If that holds an install you care about, start it only with the
line above until you have decided.

Remove it again (asks for the password again, to remove the profile):

```bash
bash "$HOME/Projects/Repositories/openldr_ce/.claude/worktrees/desktop-app-af24b7/install/desktop.sh" --uninstall
```

After it, this prints nothing:

```bash
ls /etc/apparmor.d | grep openldr-desktop
```

Tell the builder: the `exit=` line and the JSON line from the check; whether `sudo` asked once;
and anything the install or the uninstall printed that looked wrong.

Two leftovers from the build you may delete (a crash report from the one start that was meant to
fail without the profile):

```bash
sudo rm -f /var/crash/_usr_lib_cargo_bin_coreutils_timeout.1000.crash /var/crash/_usr_lib_cargo_bin_coreutils_timeout.1000.upload
```

## 2. The Windows laptop

In PowerShell on the laptop, with the server from "Before you start" running:

```powershell
$env:OPENLDR_DESKTOP_DOWNLOAD_BASE='http://100.107.125.94:3996'; & ([scriptblock]::Create((irm http://100.107.125.94:3996/desktop.ps1))) -Version 0.1.11
```

The download is about 566 MB. The script says so and shows no progress bar.

The checklist. Answer each line; copy the system's own words where it showed a message.

1. Did the script itself run? If PowerShell printed a red parse error, copy it whole and stop.
   Nobody has ever run this script.
2. Did Windows warn or block anything while downloading, unpacking or starting? Give its words.
   Look for SmartScreen, Smart App Control and Defender.
3. Did the script end with `OK` lines naming `...\Programs\OpenLDR`? If it ended with an `X`
   line, copy it. The lines most likely to fail first: the move of the unpacked folder ("access
   denied" or "used by another process": run the line once more), the unpack with `tar.exe`, and
   the download.
4. Is `OpenLDR` in the Start menu, with the OpenLDR icon? Start it from there.
5. Did a window open? What did the starting page show? If no window: is
   `%LOCALAPPDATA%\Programs\OpenLDR\OpenLDR.exe` still there, or did Defender remove it?
6. Did Studio's "Create the administrator" page appear with the setup code already filled in and
   locked?
7. Create the administrator. Did the three first-run steps show? Name the lab, load sample data,
   open OpenLDR.
8. Close the window. Is there an OpenLDR icon in the system tray (it may be under the `^`)? Open
   its menu: Open OpenLDR, Start when I sign in, Open the log folder, Quit.
9. Start OpenLDR again from the Start menu while it runs. Does the first window come back?
10. Quit from the tray. Did a "stopping" page show, and did the app exit by itself? Then in
    PowerShell: `Get-Process postgres -ErrorAction SilentlyContinue` should print nothing.
11. Start it again. Does it open on the sign-in page, with the administrator you made? Then end
    `OpenLDR.exe` from Task Manager (End task on the top one), start it once more, and say what
    happens. On Linux, OpenLDR keeps running after the app is killed and the next start shows it.
    Whether that holds on Windows is not known.
12. In PowerShell, with OpenLDR stopped:
    `& "$env:LOCALAPPDATA\Programs\OpenLDR\openldr-standalone.cmd" status; $LASTEXITCODE`
    Does it print "OpenLDR is not running." and `3`? With OpenLDR running, the address and `0`?
    Does any text show at all?
13. Run the install line again while OpenLDR runs. It should refuse and say OpenLDR is running,
    before it downloads anything. Quit OpenLDR and run it again: it should update.
14. Does Postgres start on a Windows with no Visual C++ runtime? The package ships no
    `vcruntime140.dll`. If this laptop has the runtime (most do), say so; Windows Sandbox is a
    clean Windows to try on, if you want the real answer.
15. What is the Windows user folder's name? Say only whether it has a space or a non-English
    letter.
16. Sign out of Windows, or shut down, with OpenLDR running. Sign in again and start it. Did it
    start normally, or did the starting page say the database is recovering?
17. If anything failed: the last 40 lines of `%APPDATA%\OpenLDR Desktop\desktop.log`, and of
    `logs\server.log` and `logs\postgres.log` under `%LOCALAPPDATA%\OpenLDR`.

Remove it when you are done:

```powershell
$env:OPENLDR_DESKTOP_DOWNLOAD_BASE='http://100.107.125.94:3996'; & ([scriptblock]::Create((irm http://100.107.125.94:3996/desktop.ps1))) -Uninstall
```

After it: the Start menu entry is gone, `%LOCALAPPDATA%\Programs\OpenLDR` is gone, and
`%LOCALAPPDATA%\OpenLDR` (the data) is still there. If you ticked "Start when I sign in", check it
no longer starts at sign-in.

## 3. The Mac mini

In Terminal on the Mac, with the server from "Before you start" running:

```bash
curl -fsSL http://100.107.125.94:3996/desktop.sh | OPENLDR_DESKTOP_DOWNLOAD_BASE=http://100.107.125.94:3996 bash -s -- --version 0.1.11
```

The download is about 604 MB. The app goes to `~/Applications/OpenLDR.app`. The script signs it on
the Mac with an ad-hoc signature; that step is a guess nobody could try.

The checklist:

1. Did the script end with a `✓` line naming `~/Applications/OpenLDR.app`? If it printed a `⚠`
   line about signing, or a `✗` line, copy it.
2. Open it: `open ~/Applications/OpenLDR.app`. Did macOS refuse it, or say it is damaged, or ask
   you to confirm? Give its words. If it refused, run `xattr -l ~/Applications/OpenLDR.app` and
   `codesign -dv ~/Applications/OpenLDR.app` and give both outputs.
3. Did a window open? Did Studio's "Create the administrator" page appear with the setup code
   filled in? If the starting page showed an error instead, copy it: the likely cause is macOS
   refusing the Postgres inside the app.
4. Create the administrator and go through the three first-run steps.
5. Close the window. Is there an OpenLDR icon in the menu bar? Does its menu work?
6. Open OpenLDR again from Launchpad while it runs. Does the window come back? Try it once more
   with another Electron app running (VS Code, Slack): does the right app come forward? The app
   keeps Electron's own bundle identifier, and this is where that would show.
7. Does the Dock and Launchpad show the OpenLDR icon, or Electron's?
8. Quit from the menu bar icon. Did the app exit by itself? Then `pgrep -lf postgres` should
   print nothing.
9. Start it again: the sign-in page, with your administrator? Then end it with
   `pkill -f OpenLDR.app/Contents/MacOS/Electron`, start it once more, and say what happens.
10. In Terminal: `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone status; echo $?`
    Does it print the right line and `3` or `0`?
11. Run the install line again while OpenLDR runs: it should refuse before it downloads. Quit and
    run it again: it should update.
12. Tick "Start when I sign in", sign out and in. Does OpenLDR start? With a window or without?
13. Shut the Mac down with OpenLDR running, start it, open OpenLDR. Normal, or recovering?
14. If anything failed: the last 40 lines of
    `~/Library/Application Support/OpenLDR Desktop/desktop.log`, and of `logs/server.log` and
    `logs/postgres.log` under `~/Library/Application Support/OpenLDR`.

Remove it when you are done:

```bash
curl -fsSL http://100.107.125.94:3996/desktop.sh | bash -s -- --uninstall
```

Then list what is left, so the builder knows what uninstall misses:

```bash
ls ~/Library/Application\ Support | grep -i -e openldr -e electron; ls ~/Library/Caches | grep -i -e openldr -e electron
```

`~/Library/Application Support/OpenLDR` is the data and should still be there.

## 4. What to look at that no test can see

On each of the three systems:

- **The tray icon.** Is it there? Is it the OpenLDR mark, readable on a light and a dark bar? On
  Ubuntu it needs the AppIndicator extension, which Ubuntu ships.
- **The tray menu.** The four items, in your system's language. "Start when I sign in" shows a
  tick after you choose it, and still shows it after a restart of the app.
- **Open the log folder.** Does it open the `logs` folder of the data folder?
- **A copy button inside the app.** In Studio, Users, reset a password and press the copy button.
  Does the clipboard hold the value?
- **A link that leaves OpenLDR** (for example a docs link to GitHub). Does it open in your
  browser, not in the app's window?
- **The error page.** Start the app while port 3990 is taken by something else, with
  `OPENLDR_DESKTOP_PORT=3990`. Does the page say what went wrong, name the three log files, and
  does "Start again" work once the port is free?
- **The window's icon** in the dock or taskbar while it runs. On Linux, is it the OpenLDR icon or
  a plain one?
- **Shutdown and sign-out.** With OpenLDR running, shut the machine down. On the next start, does
  OpenLDR open normally, or does it say the database is recovering after an unclean stop? Either
  is safe; the answer says whether the app got time to stop.
- **Linux only:** after a run of the installed app, `ls ~/.cache | grep -i openldr` and
  `ls ~/.config | grep -i openldr`. Uninstall removes `~/.config/OpenLDR Desktop`; anything else
  listed is something it misses.

## 5. What to tell the builder

One message per machine is enough. For each: the numbers of the checklist lines that went wrong,
the system's own words for each, and the log lines if the checklist asked for them. "All fine" for
the rest. Never paste a setup code or a password; a setup code line in a log can be left out.

## 6. Clean-up when you are done

- Stop the file server (Ctrl+C in its terminal). Check: `ss -ltn | grep 3996` prints nothing.
- Remove the try folder: `rm -r /tmp/openldr-try`.
- The packages in `dist/desktop` can stay until the first real release; they are about 1.7 GB.
