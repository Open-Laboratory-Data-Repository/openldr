# Start here

OpenLDR Studio is the browser app for your lab's records. Open it to use dashboards, reports and forms.

Start by getting access to Studio. If another guide asks you to run a command, use the CLI walkthrough below first. You do not need sample data to follow this page.

## Open Studio

Get the Studio address and an account from your administrator. Open that address in your browser, then sign in.

You can use Studio from another computer or a phone. If your organisation requires Tailscale or a VPN, connect before opening the address.

Once you have signed in, [continue with the Dashboard guide](/docs/dashboard), or read on if you need the command line.

## Use the command line

The command-line interface, or CLI, runs OpenLDR tasks from typed commands. You enter them in a terminal window.

Use the CLI to import files and maintain your installation. Follow the installed walkthrough below, or [jump to the development checkout walkthrough](#example-1-use-the-cli-in-a-development-checkout) if you run OpenLDR from source.

In this walkthrough, you will open a terminal and ask OpenLDR for help. These help commands do not import or change records.

### Before you begin

You need access to the computer hosting OpenLDR and its actual installation folder. Run the installed CLI from that folder, which contains `docker-compose.yml` and the OpenLDR command file. The installed CLI uses Docker, so Docker and OpenLDR must be running. Your account must have permission to use Docker.

Use the terminal on the computer where you installed OpenLDR. If you are working remotely, connect to that computer before running the installed commands.

### I am connecting to a remote server

Opening Studio through Tailscale gives you access to the browser app. Run commands through your existing SSH or remote terminal access to that computer.

SSH opens a secure terminal session on another computer. Use the server address, account and sign-in method you configured. A connection command can look like:

```sh
ssh username@server-address
```

Replace `username` and `server-address` with your connection details. After connecting, follow the steps for the server's operating system.

<!-- cli-platform -->

If you downloaded OpenLDR and installed it in `~/Downloads/openldr_ce`, the commands below show how to use that installation.

If you installed it somewhere else, replace this example path with your actual installation folder throughout the guide.

<!-- cli:linux -->Here, ~ means your home folder. ~/Downloads/openldr_ce is the openldr_ce folder inside Downloads.<!-- /cli -->
<!-- cli:mac -->Here, ~ means your home folder. ~/Downloads/openldr_ce is the openldr_ce folder inside Downloads.<!-- /cli -->
<!-- cli:windows -->C:\openldr_ce is the openldr_ce folder directly on the C: drive.<!-- /cli -->

These illustrations share the same window style. Commands and paths follow your operating-system selection. Select a picture to enlarge it.

### 1. Open a terminal

<!-- cli:linux -->Press the Super key, often the Windows-logo key. Type Terminal in the applications search, then select Terminal.<!-- /cli -->
<!-- cli:mac -->Press Command and Space to open Spotlight. Type Terminal, then press Return.<!-- /cli -->
<!-- cli:windows -->Press the Windows key. Type PowerShell, select Windows PowerShell, then choose Open.<!-- /cli -->

A terminal window opens. The line ending in <!-- cli:linux -->`$`<!-- /cli --><!-- cli:mac -->`%`<!-- /cli --><!-- cli:windows -->`>`<!-- /cli --> is the **prompt**. The vertical line after it is the cursor. This is where your typing appears.

![Illustrated new terminal with a prompt and cursor ready for typing.](start-terminal-linux-ready.png)

Your name and computer name may be different. Type after the prompt.

Do not type the prompt. If you make a typing mistake, use **Backspace** to correct it before pressing Enter.

### 2. Go to the installation folder

OpenLDR's installed command file is in its installation folder. The commands in this guide must run from that folder. Opening a terminal alone does not put you there.

For this example, OpenLDR is installed in `~/Downloads/openldr_ce`. Use the location you chose during installation.

![Illustrated file browser showing the example OpenLDR installation and its files.](start-terminal-linux-folder.png)

This is the example installation folder. Your actual folder must contain the installed OpenLDR files.

`cd` changes the folder your terminal is using. In your terminal, type the command below and press **Enter**. Substitute your actual location if it differs.

```sh
cd ~/Downloads/openldr_ce
```

![Illustrated terminal with cd pointing to the example installation folder.](start-terminal-linux-cd.png)

There is a space after cd. The rest of the command is the installation location.

The terminal usually prints no success message for `cd`. A new prompt appears. If an error appears instead, check the folder location before continuing.

![Illustrated terminal after changing to the example installation folder.](start-terminal-linux-changed.png)

The new prompt shows that you changed folders. Check its files next.

### 3. Check that this is the right folder

List the files in the folder. Type the following command and press **Enter**.

```sh
ls
```

![Illustrated terminal listing the data folder, docker-compose.yml and the OpenLDR command file.](start-terminal-linux-files.png)

This illustration shows the files you need. Your folder may contain other files too.

**Check before continuing**

Look for `docker-compose.yml`, the `data` folder, and `openldr`. If these are missing, return to the folder created by your installer.

### 4. Ask OpenLDR for help

Stay in the installation folder you checked in step 3. Now run your first OpenLDR command. It displays help without changing records.

```sh
./openldr --help
```

Type the command at the new prompt and press **Enter**. Keep the space before `--help` and both hyphens.

![Illustrated terminal with the OpenLDR help command typed before pressing Enter.](start-terminal-linux-help.png)

The command is ready. Press Enter to run it.

**Expected result**

The terminal prints a usage line, options and a list of commands. The picture below shows an excerpt.

![Illustrated excerpt of OpenLDR help output with Usage, Options and Commands.](start-terminal-linux-help-result.png)

Scroll in your terminal to read the full output. When the prompt returns, you can type again.

### 5. Get help for one command

The `ingest` command imports a file. Add `--help` to read its instructions without importing anything.

```sh
./openldr ingest --help
```

Type this at the prompt, then press **Enter**.

![Illustrated terminal with ingest --help typed before pressing Enter.](start-terminal-linux-ingest.png)

There is a space between the program, command name and option.

**Expected result**

The usage line now names `ingest`. The options underneath apply to that command.

![Illustrated ingest help output with a required file placeholder and command options.](start-terminal-linux-ingest-result.png)

`<file>` means a required file path. `[options]` means optional settings. Do not type these brackets.

You have reached the end of the first-command walkthrough. No file has been imported. Continue below to learn how file paths work before following an import guide.

More help opening a terminal: [Ubuntu](https://ubuntu.com/desktop/docs/en/26.04/tutorial/the-linux-command-line-for-beginners/), [macOS Spotlight](https://support.apple.com/guide/mac-help/mchlp1008/mac), [Windows PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/windows-powershell/starting-windows-powershell).

## Example 1: use the CLI in a development checkout

Use this walkthrough when you run OpenLDR from its source code. You will run the CLI through `pnpm`, check a file, then import it when you are ready.

Start with a development checkout whose dependencies and `.env` are already configured. This walkthrough was checked with Node.js 24 and the checkout's pinned pnpm 11.22.0.

The development CLI runs on your computer. It uses the databases and storage configured in that checkout's `.env`. It does not need the Studio or API development server to be running.

The operating-system choice above also changes the paths and pictures in this section.

### 1. Open the source checkout in your terminal

For this example, the source checkout is at `~/Downloads/openldr_ce`. Substitute the location where you cloned the repository.

```sh
cd ~/Downloads/openldr_ce
```

This folder contains `package.json`, `pnpm-workspace.yaml`, `apps` and `packages`. Use this repository root for the following commands.

![Illustrated terminal in the source checkout, listing its package.json and workspace folders.](start-terminal-linux-dev-root.png)

The source checkout has the workspace files. It uses the pnpm command below.

### 2. Run the development CLI

Ask for help, then read the import command's help. Enter one command at a time.

```sh
pnpm openldr --help
pnpm openldr ingest --help
```

![Illustrated source commands pnpm openldr --help and pnpm openldr ingest --help with their usage lines.](start-terminal-linux-dev-help.png)

These commands display help. They do not import data.

`pnpm openldr` runs `packages/cli/dev.mjs` from this checkout. Use that prefix for CLI commands while developing.

### 3. Check a file on your computer

The development CLI can read ordinary local paths. Files do not have to be in Docker's shared `data` folder.

For example, if your own FHIR JSON file is at `~/Downloads/openldr_ce/files/my-file.json`, validate it from the repository root:

```sh
pnpm openldr fhir validate files/my-file.json
```

![Illustrated development CLI reading files/my-file.json outside the Docker data folder and reporting all valid.](start-terminal-linux-dev-file.png)

The test file was valid. Your result depends on the contents of your own file. Validation does not import it.

### 4. Import into your development database

Use this step when you intend to import the file. Check that the checkout's `.env` points to your development databases and storage. Those backing services must be running.

```sh
pnpm openldr ingest files/my-file.json
pnpm openldr pipeline status
```

![Illustrated source CLI importing a file and showing its completed batch in pipeline status.](start-terminal-linux-dev-import.png)

The tested file produced a completed batch with one resource. Your batch ID and count will differ.

For the other CLI commands in these guides, keep the `pnpm openldr` prefix and use paths on your computer.

## Use file paths in an installed setup

Before you import a file, check what each part of the command means. This example uses a placeholder filename:

```sh
./openldr ingest data/my-file.json
```

- `./openldr`: Starts the installed CLI.

- `ingest`: Imports a file into OpenLDR.

- `data/my-file.json`: The file to import. Replace it with the path to your actual file.

In this example, put the file at `~/Downloads/openldr_ce/data/my-file.json`, inside the same installation folder used above:

```sh
~/Downloads/openldr_ce/
  docker-compose.yml
  openldr
  data/
    my-file.json
```

Run the command from `~/Downloads/openldr_ce`. Keep the `data/` prefix in the file argument because it is relative to the installation folder.

The installed CLI runs inside OpenLDR's API container. The `data` folder is shared with that container. This lets the command read files you place there.

If OpenLDR is on a remote server, place the file in that server's installation folder. Saving it on your laptop does not put it on the server.

For commands that write files, use an output path under `data/` too. Put quotation marks around a path containing spaces, such as `"data/my file.json"`.

Each task's guide explains which file format and command options to use. The example above explains the path only. Running an import command writes records.

## Troubleshooting

Start in the folder where you installed OpenLDR. Match the error below before changing anything. The commands follow the operating-system choice above.

These error messages and recoveries were reproduced on Linux with the installed launcher and the real CLI. The transcript pictures show that Linux test. Windows and macOS wording can differ.

### The launcher or Compose configuration cannot be found

You may see `./openldr: not found`, or `no configuration file provided: not found`.

The first error means the launcher is not in your current folder. The second occurred when the launcher was called from another folder, so Docker Compose could not find the installation's configuration.

Return to the actual installation folder. In this guide's example, run:

```sh
cd ~/Downloads/openldr_ce
./openldr --help
```

The help usage line confirms that the launcher ran. If it still cannot be found, list the folder's files as shown in step 3. Check for `openldr` and `docker-compose.yml`.

![Illustrated Linux transcript showing launcher not found, changing into the installation folder, then successful CLI help.](start-proof-wrong-folder.png)

Tested result: returning to the installation folder restored the help command.

### Docker is using an unreachable connection address

The test reported `failed to connect to the docker API`. This happened before OpenLDR started because `DOCKER_HOST` pointed to a socket that did not exist.

Run `docker info` to check the Docker connection. Read the address in its error. If you previously set `DOCKER_HOST` and that value is now wrong, clear it in this terminal:

```sh
unset DOCKER_HOST
```

This clears the override for the current terminal. Use it only when that override is the cause. It does not start a stopped Docker engine.

```sh
docker info
./openldr --help
```

The test recovered after clearing the incorrect address. If `docker info` still fails, Docker is not yet reachable. Read that Docker error before retrying OpenLDR.

![Illustrated Linux transcript showing an unreachable Docker socket, clearing DOCKER_HOST, and successful CLI help.](start-proof-docker.png)

The test used a deliberately missing Docker socket. The running Docker engine was left untouched.

### Docker says service api is not running

The exact tested error was `service "api" is not running`. Docker was reachable, but the installation's API container was stopped. The installed CLI runs inside that container.

From your installation folder, inspect the container and start it again:

```sh
docker compose ps -a api
docker compose up -d api
```

Then run the help command again:

```sh
./openldr --help
```

![Illustrated Linux transcript showing the stopped API error, starting the API service, and successful CLI help.](start-proof-api.png)

Tested result: starting the stopped container restored the help command.

### The import reports ENOENT for my file

The test reported `ingest failed: ENOENT: no such file or directory, open 'my-file.json'`.

The file existed on the computer, beside the launcher. The installed CLI could not see it because only the installation's `data` folder was shared with its container.

Move the file into that `data` folder. In this guide's example, its full location becomes `~/Downloads/openldr_ce/data/my-file.json`.

Check the moved file without importing it:

```sh
./openldr fhir validate data/my-file.json
```

For a valid FHIR JSON file, the result includes `all valid`. If you intend to import it, retry with the shared path:

```sh
./openldr ingest data/my-file.json
```

![Illustrated Linux transcript showing ENOENT outside the shared data folder, moving the file, successful validation and a completed import.](start-proof-file.png)

The same file failed outside data, then validated and imported after moving into it.

This shared-folder rule applies to the installed Docker launcher. The development CLI can read normal local paths, as shown in the development walkthrough.

## Related guides

The Dashboard guide explains how to create a dashboard and add widgets using your own data. You can configure them before records arrive. Optional sample exercises come after the main instructions.

[Open the Dashboard guide](/docs/dashboard)

 [Back to the top](#start-here)
