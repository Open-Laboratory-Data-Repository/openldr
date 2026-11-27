# Open OpenLDR from another PC

A lab needs one OpenLDR, not one on every PC. Share it on the lab network, and the other PCs open it in a browser and sign in to the same users and data. This guide is for the person who looks after the PC that runs OpenLDR.

It covers the desktop app and the standalone launcher. A Docker install is already reached over the network at its own address.

This guide has no clip. The steps happen in the tray and on another PC, outside Studio.

## Share this PC's OpenLDR

Do this once, on the PC that runs OpenLDR.

1. Open the OpenLDR icon in the system tray, the area of the taskbar with small icons.
2. Select **Share on the lab network**.
3. Read the question, then select **Share**.
4. Wait while the window shows **Stopping OpenLDR** and then **Starting OpenLDR**.
5. Open the tray icon again and select **Copy network address**.

**Expected result:** the tray menu shows an address that starts with `https://`, and that address is copied.

If OpenLDR was started outside the app, nothing restarts. The app says the change applies the next time it starts OpenLDR.

On a PC with no desktop app, start the launcher with `openldr-standalone start --share`. It prints the address, a second address with numbers, and the certificate fingerprint.

## Open it on another PC

1. On the other PC, open a browser such as Chrome or Edge.
2. In the address bar, type the address from the first PC, such as `https://labpc:3443/studio/`.
3. When the browser warns about the certificate, check it first. See **Check the certificate** below.
4. Accept the certificate.
5. Sign in with your OpenLDR username and password.

**Expected result:** Studio opens, with the same data as on the first PC.

If the address with the PC's name does not open, use the one with numbers, such as `https://192.168.1.20:3443/studio/`. The launcher prints both. The tray shows one. For the others, run `openldr-standalone status --json` on the first PC and read `share.addresses`.

## Check the certificate

The first PC makes its own certificate, so a browser does not know it. Check that it is the right one before you accept it.

1. On the first PC, open the tray icon and select **Copy certificate fingerprint**. With the launcher, read the line that starts `Certificate fingerprint (SHA-256):` in its terminal.
2. Paste it somewhere you can read it, or read it aloud to the person at the other PC.
3. On the other PC, open the certificate's details from the browser's warning.
4. Find the **SHA-256** fingerprint.
5. Compare the two, pair by pair.

**Expected result:** the two fingerprints are the same. Then accept the certificate. If they differ, stop and do not sign in.

## Use the OpenLDR app on another PC

Do this on the other PC when you want the OpenLDR app there instead of a browser. The app then shows this lab's OpenLDR and holds no data of its own.

1. Install the OpenLDR desktop app on the other PC and start it.
2. On the first screen, select **Connect to the lab's server**.
3. In **Server address**, type the address from the first PC, such as `https://labpc:3443/studio/`.
4. Select **Connect**.
5. Compare the fingerprint the app shows with the one from the first PC. See **Check the certificate** above.
6. Select **It matches**.
7. Sign in with your OpenLDR username and password.

**Expected result:** Studio opens in the app, with the same data as on the first PC. The app goes straight to it the next time it starts.

A PC that already holds OpenLDR data does not show the first screen. Use **Connect to a lab server...** in its tray menu.

## Lock a PC to OpenLDR

Do this on a PC in a shared room that should show OpenLDR and nothing else.

1. Open the OpenLDR icon in the system tray.
2. Select **Lock this PC to OpenLDR...**.
3. Type a PIN of at least 4 characters.
4. Select **Lock**.

**Expected result:** the window fills the screen, closing it does nothing, and links to other sites do not open.

To unlock, press `Ctrl+Shift+L`, type the PIN, and select **Unlock**. Quitting the app asks for the PIN too. The web guide for the desktop app says what the lock does not stop, and what to do about a forgotten PIN.

## Limits

- The first PC must be on, with OpenLDR running, whenever the others use it.
- A new network address or a new name for the first PC makes a new certificate. The other PCs then see the warning once more. Give the first PC a fixed address to avoid it.
- Use it on the lab's own network only. Never open it to the internet.

## Troubleshooting

- **The tray menu shows "No network address was found".** The PC is on no network. Join one, quit OpenLDR and open it again.
- **The app says port 3443 is already in use.** Another program uses it. The web guide for the desktop app shows how to pick another port.
- **The other PC cannot open the address.** Check that both PCs are on the same network, and that the first PC's firewall allows port 3443.
- **The app shows "Cannot reach the server".** The first PC is off, or the network is down. The app comes back by itself when the first PC answers.
- **The app shows "The server's certificate has changed".** The first PC has a new name or network address. Compare the new fingerprint before you select **It matches**.

## Related guides

- [Sign-in and passwords](/docs/sign-in)
- [First run](/docs/first-run)
