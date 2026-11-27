# Choose a lab setup

One rule covers every lab. Each site has one full OpenLDR install, and every other PC at that site is a screen onto it. The install holds the data and the users. The other PCs run no lab database of their own.

This page describes four setups. Pick the one that matches your site, then follow the links for the steps.

## Small site with a weak link

A site that tests its own samples and has a poor internet link. It may send some samples on to a bigger lab.

- **What to install.** The [desktop app](/docs/desktop-app) on one PC, set to **This PC holds the lab's data**.
- **Where the users are made.** On that PC. The site has its own users.
- **When the internet is down.** Work goes on. The data is on the PC, so nothing at the site needs the link. Records for the national OpenLDR wait until the link is back.

Give this site its own install even when a bigger lab is near. A screen onto another site's OpenLDR stops every time the link drops.

## Lab with two PCs

One PC holds the data and the second PC shows it.

- **What to install on PC 1.** The desktop app, set to **This PC holds the lab's data**, with **Share on the lab network** ticked in its tray menu.
- **What to install on PC 2.** The desktop app, set to **Connect to the lab's server**, with PC 1's address. A browser on PC 2 works too.
- **Where the users are made.** Once, on PC 1. PC 2 signs in to the same users.
- **When the network is down.** PC 1 works as before. On PC 2, an app that is starting shows **Cannot reach the server** and comes back by itself when it can reach PC 1. A Studio page that is already open stays on screen, and what it sends fails until PC 1 answers. A browser shows its own error page instead.

PC 1 must be on, with OpenLDR running, whenever PC 2 is used. Back up PC 1 only. PC 2 runs no lab database.

## Bigger lab with many PCs

A lab with a reception and several benches. Other sites may send it samples.

- **What to install on the server.** The server edition, with Docker. See [Install](/docs/install). It has HTTPS and is built to face a network.
- **What to install on every other PC.** The desktop app, set to **Connect to the lab's server**, or a browser.
- **Where the users are made.** On the server. It is one site with one set of users.
- **When the network is down.** An app that is starting shows **Cannot reach the server** and comes back by itself. A Studio page that is already open stays on screen, and what it sends fails until the server answers. The server keeps its data. Keep the server on a power supply that rides out short cuts.

## PC beside an analyser

A PC that sits next to an instrument and passes its results on.

- **What to install.** No OpenLDR server and no database. The PC runs the program that reads the instrument. That program comes with the plugin for the instrument, and it is pointed at the site's OpenLDR.
- **Where the users are made.** Nowhere on this PC. The program signs in to the site's OpenLDR with one account. The plugin's guide says which account to use.
- **When the network is down.** The plugin's guide says what the program keeps and what it sends later.

To let people use Studio on this PC as well, add the desktop app set to **Connect to the lab's server**.

## How to choose

| Your site | Setup |
| --- | --- |
| One PC, or a link that often drops | Small site with a weak link |
| Two or three PCs in one room | Lab with two PCs |
| A reception, several benches, or samples from other sites | Bigger lab with many PCs |

## What stays the same in every setup

- Each site keeps its own users. Signing in does not need the national OpenLDR.
- Only the PC that holds the data needs a backup.
- A PC that connects to a server shows the server's version of Studio. Update the server, and every screen follows.
- Sharing is for the lab's own network. Never open a shared desktop app to the internet.

## Limits

- Sending a sample from one site's OpenLDR to another's is not in this release.
- A PC in connect mode installs the same package as a PC that holds the data, about 500 to 600 MB. A smaller package is later work.
- These setups were tried with both ends on one computer. A run on two real PCs is still to be done.

## Related guides

- [Desktop app](/docs/desktop-app)
- [Run without Docker](/docs/standalone)
- [Install](/docs/install)
- [Requirements](/docs/requirements)
