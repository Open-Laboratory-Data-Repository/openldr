// The Electron main process. It only wires Electron to the controller and the other modules; the
// decisions live in controller.ts, autostart.ts, locality.ts and selfcheck.ts.

import { appendFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, powerMonitor, session, shell, Tray } from 'electron';
import { setAutostart, startedHidden, type AutostartDeps } from './autostart';
import { bridgeHandlers } from './bridge';
import { readServerCertificate, verifyDecision, type PinnedServer } from './cert-trust';
import { ACTION_CHANNEL, RETRY_CHANNEL, SCREEN_CHANNEL } from './channels';
import { DesktopController, pageState, type PageAction, type Screen } from './controller';
import * as launcher from './launcher';
import { frameTarget, linkTarget, mayGrantPermission, renderAfterLoad, sameOrigin, urlForLog } from './locality';
import { startMode, type Running } from './mode';
import { choosePort } from './ports';
import { RemoteController } from './remote-controller';
import { Selfcheck, selfcheckConfig } from './selfcheck';
import { parseServerAddress } from './server-address';
import { loadSettings, saveSettings, type Settings } from './settings';
import { pickLang, STRINGS } from './strings';
import { createShareSwitch } from './share-switch';
import { trayTemplate } from './tray-menu';

export type MainWindow = BrowserWindow;

/** Marks a start the app asked for itself, after the window held an old refusal of a certificate. */
const CERT_RELAUNCH = '--openldr-cert-relaunch';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

app.setName('OpenLDR Desktop');
const userDir = env.OPENLDR_DESKTOP_USER_DIR || join(app.getPath('appData'), 'OpenLDR Desktop');
app.setPath('userData', userDir);

if (!app.requestSingleInstanceLock()) {
  // Another start of the app owns this folder. It shows its window on `second-instance`.
  app.exit(0);
} else {
  main();
}

function main(): void {
  mkdirSync(userDir, { recursive: true });
  const logFile = join(userDir, 'desktop.log');
  const settingsFile = join(userDir, 'settings.json');
  const pagePath = join(here, '..', 'pages', 'page.html');
  const pageUrl = pathToFileURL(pagePath).href;
  const target: launcher.LauncherTarget = {
    execPath: process.execPath,
    entry: resolve(here, '..', '..', 'standalone', 'dist', 'index.js'),
    ...(env.OPENLDR_DESKTOP_DATA_DIR ? { dataDir: env.OPENLDR_DESKTOP_DATA_DIR } : {}),
  };
  const fixedPort = env.OPENLDR_DESKTOP_PORT ? Number(env.OPENLDR_DESKTOP_PORT) : undefined;
  const check = selfcheckConfig(env);

  const log = (line: string): void => {
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // A log that cannot be written must not stop the app.
    }
  };
  const save = (s: Settings): void => {
    try {
      saveSettings(settingsFile, s);
    } catch (err) {
      log(`The settings could not be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  /** The app's words, in the system language. Only after `ready`. */
  const strings = () => STRINGS[pickLang(app.getLocale())];

  log(`The app started. Electron ${process.versions.electron}, ${process.platform}.`);

  let win: BrowserWindow | undefined;
  let tray: Tray | undefined;
  /** Builds the tray menu again from the settings and the launcher's share. Set once the tray exists. */
  let rebuildTray = (): void => {};
  /** The controller that runs, once the mode is known: OpenLDR on this PC, or shown from another PC. */
  let running: Running | undefined;
  const local = (): DesktopController | undefined => (running?.mode === 'local' ? running.controller : undefined);
  const remote = (): RemoteController | undefined => (running?.mode === 'connect' ? running.controller : undefined);
  const connectMode = (): boolean => running?.mode === 'connect';
  /** The one certificate, beyond what the system trusts, that the window accepts. Connect mode only. */
  let pinned: PinnedServer | undefined;
  /** Hosts whose certificate the window's own check has refused. */
  const windowRefused = new Set<string>();
  /** How many launchers this app has started. Connect mode starts none. */
  let childProcesses = 0;
  let selfcheck: Selfcheck | undefined;
  let current: Screen = { screen: 'starting', note: 'checking' };
  /** Set once the app has decided to end. The window then closes for real. */
  let exiting = false;
  /** Set once the controller has been started. Not when the launcher was found not built. */
  let launched = false;
  /** True while the app's own page is loading. Its did-finish-load sends the screen. */
  let pageLoading = false;

  const exit = (code: number): void => {
    exiting = true;
    log(`The app exits with code ${code}.`);
    app.exit(code);
  };

  /** Every way to quit ends here: the tray, the app menu, before-quit, a signal, a shutdown. */
  const requestQuit = (why: string): void => {
    if (exiting) return;
    log(`Quit asked for: ${why}.`);
    if (running === undefined) return exit(0);
    void running.controller.quit();
  };

  // Before anything is started, so no launcher can run while these are missing.
  process.on('SIGTERM', () => requestQuit('SIGTERM'));
  process.on('SIGINT', () => requestQuit('SIGINT'));
  app.on('before-quit', (event) => {
    if (exiting) return;
    event.preventDefault();
    requestQuit('before-quit');
  });
  // The window hides rather than closes, so this fires only if it was destroyed some other way.
  app.on('window-all-closed', () => {});

  const showWindow = (): void => {
    if (win === undefined || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  app.on('second-instance', showWindow);
  // macOS sends this when a running app is opened again.
  app.on('activate', showWindow);

  const onOwnPage = (): boolean => win !== undefined && linkTarget(win.webContents.getURL(), undefined, [pageUrl]) === 'inside';

  const render = (): void => {
    if (win === undefined || win.isDestroyed()) return;
    const screen = current;
    if (screen.screen === 'studio') {
      pageLoading = false;
      // The address always comes from the launcher's `ready` event or its status, never from the port.
      void win.loadURL(screen.address).catch((err: unknown) => log(`Studio did not load: ${String(err)}`));
      return;
    }
    if (pageLoading) return;
    if (!onOwnPage()) {
      pageLoading = true;
      void win.loadFile(pagePath).catch((err: unknown) => log(`The app's page did not load: ${String(err)}`));
    } else if (!win.webContents.isLoading()) {
      win.webContents.send(SCREEN_CHANNEL, pageState(screen, strings()));
    }
  };

  const show = (screen: Screen): void => {
    current = screen;
    // The share the launcher reports changes with the screen: set at ready, gone at a stop.
    rebuildTray();
    if (screen.screen === 'error') selfcheck?.onError(pageState(screen, strings()).title);
    render();
  };

  // Every page the app makes: links that leave OpenLDR open in the person's browser.
  app.on('web-contents-created', (_e, contents) => {
    const guard = (event: { preventDefault(): void }, url: string): void => {
      const where = linkTarget(url, running?.controller.address(), [pageUrl]);
      if (where === 'inside') return;
      event.preventDefault();
      if (where === 'browser') void shell.openExternal(url);
    };
    // A frame inside a page may stay on the launcher's origin or load about:blank or about:srcdoc
    // (Studio's plugin frames). Anything else is stopped, and never opened in the browser.
    const frameGuard = (event: { preventDefault(): void }, url: string): void => {
      if (frameTarget(url, running?.controller.address()) === 'refuse') event.preventDefault();
    };
    contents.on('will-navigate', (event) => guard(event, event.url));
    // A redirect fires for frames too. Only the main frame's may open the browser.
    contents.on('will-redirect', (event) => (event.isMainFrame ? guard(event, event.url) : frameGuard(event, event.url)));
    // will-navigate covers the main frame only.
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      frameGuard(event, event.url);
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (linkTarget(url, running?.controller.address(), [pageUrl]) === 'browser') void shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  // Studio's two calls. bridge.ts checks each sender against the launcher's address, and answers
  // only while that address is this computer. The code itself is never logged.
  const handlers = bridgeHandlers({
    // Always undefined in connect mode: the two calls stay off for a server on another PC.
    address: () => running?.controller.bridgeAddress(),
    requestSetupCode: () =>
      launcher.requestSetupCode(target).catch((err: unknown) => {
        log(`Studio asked for a code and got none: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }),
    info: () => ({ version: app.getVersion(), platform: process.platform }),
  });
  for (const [channel, handle] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event) => handle(event.senderFrame?.url ?? ''));
  }

  ipcMain.on(RETRY_CHANNEL, (event) => {
    // Only from one of the app's own pages.
    const from = event.senderFrame?.url ?? '';
    if (linkTarget(from, undefined, [pageUrl]) !== 'inside') return;
    retry();
  });

  /** Try again. The launcher must be built in local mode only: connect mode runs none. */
  const retry = (): void => {
    if (running === undefined) return;
    if (running.mode === 'local' && !existsSync(target.entry)) return show({ screen: 'error', message: strings().notBuilt });
    if (launched) return void running.controller.retry();
    launched = true;
    void running.controller.start();
  };

  /** Set once the app is ready: start one of the two controllers. */
  let startLocal = (): void => {};
  let startRemote = (): void => {};

  const ACTIONS: ReadonlySet<string> = new Set<PageAction>([
    'choose-local', 'choose-connect', 'connect', 'back', 'trust', 'no-trust', 'retry', 'change-server', 'pin-submit', 'pin-cancel',
  ]);
  ipcMain.on(ACTION_CHANNEL, (event, payload: unknown) => {
    // Only from one of the app's own pages, as for the retry channel.
    const from = event.senderFrame?.url ?? '';
    if (linkTarget(from, undefined, [pageUrl]) !== 'inside') return;
    const p = payload as { id?: unknown; value?: unknown } | null;
    if (typeof p?.id !== 'string' || !ACTIONS.has(p.id)) return;
    const value = typeof p.value === 'string' ? p.value.slice(0, 2000) : '';
    switch (p.id as PageAction) {
      case 'choose-local':
        if (running !== undefined) return;
        save({ ...loadSettings(settingsFile), mode: 'local' });
        return startLocal();
      case 'choose-connect':
        // The mode is saved with the first server that works. Until then Back leads here again.
        if (running !== undefined) return;
        return startRemote();
      case 'back':
        // Only from the connect screen, and only while no mode is saved.
        if (running?.mode !== 'connect' || loadSettings(settingsFile).mode !== undefined) return;
        running = undefined;
        launched = false;
        return show({ screen: 'choose' });
      case 'connect':
        return void remote()?.connect(value);
      case 'trust':
        return void remote()?.trust(true);
      case 'no-trust':
        return void remote()?.trust(false);
      case 'change-server':
        return remote()?.changeServer();
      case 'retry':
        return retry();
      default:
        // 'pin-submit' and 'pin-cancel' belong to the lock.
        return;
    }
  });

  void app.whenReady().then(() => {
    // A quit that came before this point has already exited. Start nothing.
    if (exiting) return;
    const s = strings();
    const settings = loadSettings(settingsFile);

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
      callback(mayGrantPermission(permission, details.requestingUrl, running?.controller.address(), connectMode())),
    );
    session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
      mayGrantPermission(permission, requestingOrigin, running?.controller.address(), connectMode()),
    );
    // The window's own certificate check. Chromium's verdict stands, plus the one pinned
    // certificate in connect mode. Electron asks this once per certificate and keeps the answer
    // until the app ends, so the pin must be settled before the window first meets the server.
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      const decision = verifyDecision(request, pinned);
      if (decision === 0) windowRefused.delete(request.hostname.toLowerCase());
      else windowRefused.add(request.hostname.toLowerCase());
      callback(decision);
    });

    const hidden = startedHidden(process.argv, process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
    win = new BrowserWindow({
      width: settings.window?.width ?? 1360,
      height: settings.window?.height ?? 900,
      title: s.windowTitle,
      show: !hidden,
      autoHideMenuBar: true,
      icon: join(here, '..', 'assets', 'icon.png'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(here, 'preload.cjs'),
      },
    });
    const w = win;

    // Closing the window hides it. It closes for real only when the app exits.
    w.on('close', (event) => {
      if (exiting) return;
      event.preventDefault();
      w.hide();
    });
    let sizeTimer: NodeJS.Timeout | undefined;
    w.on('resize', () => {
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(() => {
        if (w.isDestroyed() || w.isMaximized() || w.isFullScreen()) return;
        const { width, height } = w.getNormalBounds();
        save({ ...loadSettings(settingsFile), window: { width, height } });
      }, 500);
    });
    // Windows asks before a sign-out or shutdown. Not proven on Windows.
    w.on('query-session-end', (event) => {
      event.preventDefault();
      requestQuit('query-session-end');
    });
    w.on('session-end', () => requestQuit('session-end'));
    // Electron's typings give this listener no event, though Linux and macOS pass one to hold the shutdown.
    (powerMonitor as unknown as { on(name: 'shutdown', listener: (event: { preventDefault(): void }) => void): void }).on(
      'shutdown',
      (event) => {
        event.preventDefault();
        requestQuit('shutdown');
      },
    );

    w.webContents.on('did-finish-load', () => {
      const url = w.webContents.getURL();
      if (onOwnPage()) {
        pageLoading = false;
        if (current.screen !== 'studio') w.webContents.send(SCREEN_CHANNEL, pageState(current, strings()));
        return;
      }
      // An error or stopping screen that came while another page was loading is shown now.
      if (renderAfterLoad(current.screen === 'studio', url, pageUrl)) return render();
      const address = running?.controller.address();
      if (address !== undefined && sameOrigin(url, address)) {
        // A Studio page that loads ends the count of failed loads.
        remote()?.studioLoaded();
        selfcheck?.onStudioLoaded();
      }
    });
    w.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      // Cleared for -3 too. Left set after a load of the app's page was replaced, every later screen is dropped.
      pageLoading = false;
      // -3 is a load another load replaced. That other load reports its own end.
      if (code === -3) return;
      log(`A page did not load (${code} ${description}): ${urlForLog(url)}`);
      // Connect mode: Studio's own page did not load from the server. Chromium's error page is
      // never left up: the controller shows the app's page and brings Studio back when it can.
      const r = remote();
      const shown = r?.address();
      if (r !== undefined && shown !== undefined && current.screen === 'studio' && sameOrigin(url, shown)) {
        const host = parseServerAddress(shown);
        const refused = host.ok && windowRefused.has(host.host.toLowerCase());
        void r.studioFailed(refused || (code <= -200 && code > -300) ? 'certificate' : 'other');
        return;
      }
      if (renderAfterLoad(current.screen === 'studio', url, pageUrl)) render();
    });
    w.webContents.on('render-process-gone', (_e, details) => log(`The window's page process ended: ${details.reason}.`));

    // The tray. The tick is the settings file's record; it is only changed by a click.
    const autostart: AutostartDeps = {
      platform: process.platform,
      home: homedir(),
      execPath: process.execPath,
      // defaultApp is true only when started as `electron <folder>`. isPackaged goes by the binary's name.
      appArgs: process.defaultApp ? [app.getAppPath()] : [],
      getLoginItemSettings: () => app.getLoginItemSettings(),
      setLoginItemSettings: (v) => app.setLoginItemSettings(v),
    };
    tray = new Tray(nativeImage.createFromPath(join(here, '..', 'assets', 'tray.png')));
    tray.setToolTip(s.trayTooltip);
    // The tray menu is rebuilt whenever what it shows changes: a setting, or the launcher's share.
    // A box with no parent when the window is hidden or gone: a box tied to a hidden window may never show.
    const box = (options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> =>
      !w.isDestroyed() && w.isVisible() ? dialog.showMessageBox(w, options) : dialog.showMessageBox(options);
    const shareSwitch = createShareSwitch({
      // A yes or no question outside Studio, so a native box. Cancel is the default.
      confirm: async () =>
        (
          await box({
            type: 'question',
            buttons: [s.shareConfirmYes, s.shareConfirmNo],
            defaultId: 1,
            cancelId: 1,
            title: s.shareConfirmTitle,
            message: s.shareConfirmTitle,
            detail: s.shareConfirmBody,
          })
        ).response === 0,
      loadSettings: () => loadSettings(settingsFile),
      // Not `save`: that one swallows a failed write, and this change must know.
      saveSettings: (v) => saveSettings(settingsFile, v),
      restart: async () => (await local()?.restart()) ?? false,
      tell: (what) => void box({ type: what === 'save-failed' ? 'error' : 'info', message: what === 'save-failed' ? s.shareSaveFailed : s.shareNextStart, buttons: ['OK'] }),
      changed: () => rebuildTray(),
      log,
    });
    const saveCertificate = async (certFile: string): Promise<void> => {
      try {
        const picked = await dialog.showSaveDialog({ defaultPath: 'openldr-certificate.pem' });
        if (picked.canceled || picked.filePath === undefined || picked.filePath === '') return;
        copyFileSync(certFile, picked.filePath);
      } catch (err) {
        log(`The certificate was not saved: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    /** Asks, saves the other mode, and starts the app again through the normal quit. */
    const switchMode = async (to: 'local' | 'connect'): Promise<void> => {
      const answer = await box({
        type: 'question',
        buttons: [s.switchConfirmYes, s.switchConfirmNo],
        defaultId: 1,
        cancelId: 1,
        message: to === 'connect' ? s.trayUseConnect.replace(/\.\.\.$/, '') : s.trayUseLocal.replace(/\.\.\.$/, ''),
        detail: to === 'connect' ? s.switchToConnectBody : s.switchToLocalBody,
      });
      if (answer.response !== 0) return;
      try {
        // Not `save`: a failed write must stop the switch.
        saveSettings(settingsFile, { ...loadSettings(settingsFile), mode: to });
      } catch (err) {
        log(`The mode was not changed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      app.relaunch();
      requestQuit('switch mode');
    };
    rebuildTray = (): void => {
      if (tray === undefined || tray.isDestroyed()) return;
      const now = loadSettings(settingsFile);
      const serverNow = now.server?.address ?? remote()?.address();
      tray.setContextMenu(
        Menu.buildFromTemplate(
          trayTemplate({
            startAtSignIn: now.startAtSignIn,
            shareOnNetwork: now.shareOnNetwork === true,
            share: local()?.share(),
            busy: shareSwitch.busy(),
            ...(connectMode() ? { mode: 'connect' as const, ...(serverNow !== undefined ? { server: serverNow } : {}) } : {}),
          }, s, {
            open: showWindow,
            setStartAtSignIn: (on) => {
              try {
                setAutostart(autostart, on);
                save({ ...loadSettings(settingsFile), startAtSignIn: on });
              } catch (err) {
                log(`Start at sign-in was not changed: ${err instanceof Error ? err.message : String(err)}`);
              }
              rebuildTray();
            },
            setShare: (on) => void shareSwitch.set(on),
            copy: (text) => clipboard.writeText(text),
            saveCertificate: (certFile) => void saveCertificate(certFile),
            openLogs: () => {
              // Connect mode has no data folder. Its only log is the app's own.
              if (connectMode()) return void shell.openPath(userDir);
              const dir = local()?.dataDir();
              if (dir !== undefined) void shell.openPath(join(dir, 'logs'));
            },
            quit: () => requestQuit('tray'),
            changeServer: () => {
              remote()?.changeServer();
              showWindow();
            },
            switchMode: (to) => void switchMode(to),
          }),
        ),
      );
    };
    rebuildTray();
    tray.on('click', showWindow);

    const makeLocal = (): DesktopController => new DesktopController({
      readStatus: () => launcher.readStatus(target),
      startLauncher: (port, on, share) => {
        childProcesses++;
        // Known once the launcher's status has been read, which happens before any start.
        const dir = local()?.dataDir() ?? target.dataDir;
        return launcher.startLauncher(target, port, on, undefined, share, dir !== undefined ? launcher.trustFileIn(dir) : undefined);
      },
      requestStop: () => launcher.requestStop(target),
      answers: async (address) => {
        try {
          const res = await fetch(address, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
          await res.body?.cancel();
          return true;
        } catch {
          return false;
        }
      },
      sleep,
      choosePort: (remembered) => choosePort(remembered),
      ...(fixedPort !== undefined ? { fixedPort } : {}),
      loadSettings: () => loadSettings(settingsFile),
      saveSettings: (v) => saveSettings(settingsFile, v),
      show,
      exit,
      log,
      // An attached launcher's share can come or change with no change of screen.
      shareChanged: () => rebuildTray(),
      desktopLog: logFile,
      strings: s,
    });

    // OPENLDR_DESKTOP_SERVER, for development and tests: it stands for the saved server and is
    // never written to the settings file. A fingerprint accepted for it lives for this run only.
    const envParsed = env.OPENLDR_DESKTOP_SERVER ? parseServerAddress(env.OPENLDR_DESKTOP_SERVER) : undefined;
    const viaEnv = envParsed?.ok === true && settings.mode === undefined;
    let envServer: Settings['server'] = envParsed?.ok ? { address: envParsed.address } : undefined;
    const remoteLoad = (): Settings => {
      const disk = loadSettings(settingsFile);
      if (!viaEnv) return disk;
      const { server: _s, ...rest } = disk;
      return { ...rest, mode: 'connect', ...(envServer ? { server: envServer } : {}) };
    };
    const remoteSave = (v: Settings): void => {
      if (!viaEnv) return saveSettings(settingsFile, v);
      envServer = v.server;
      const { server: _s, mode: _m, ...rest } = v;
      saveSettings(settingsFile, rest);
    };

    // A check of a server runs in a session of its own, made for one pin and never changed: the
    // window's session must not meet a certificate before its pin is settled (see the note at
    // setCertificateVerifyProc above). One session per pin, kept in memory only.
    const probes = new Map<string, { ses: Electron.Session; refused: Set<string> }>();
    const probeSession = (pin: PinnedServer | undefined): { ses: Electron.Session; refused: Set<string> } => {
      const key = pin === undefined ? 'none' : `${pin.host.toLowerCase()}|${pin.fingerprint}`;
      const known = probes.get(key);
      if (known !== undefined) return known;
      const made = { ses: session.fromPartition(`openldr-probe-${probes.size}`), refused: new Set<string>() };
      made.ses.setCertificateVerifyProc((request, callback) => {
        const decision = verifyDecision(request, pin);
        if (decision === 0) made.refused.delete(request.hostname.toLowerCase());
        else made.refused.add(request.hostname.toLowerCase());
        callback(decision);
      });
      probes.set(key, made);
      return made;
    };
    const probe = async (address: string, pin: PinnedServer | undefined): Promise<'ok' | 'no-answer' | 'untrusted'> => {
      const parsed = parseServerAddress(address);
      if (!parsed.ok) return 'no-answer';
      const { ses, refused } = probeSession(pin);
      try {
        const res = await ses.fetch(`${parsed.origin}/health`, { redirect: 'manual', signal: AbortSignal.timeout(5000), cache: 'no-store' });
        await res.body?.cancel();
        return 'ok';
      } catch {
        // A refusal by the check and a server that is off both end here. The check says which.
        return refused.has(parsed.host.toLowerCase()) ? 'untrusted' : 'no-answer';
      }
    };

    const makeRemote = (): RemoteController => new RemoteController({
      probe,
      readCertificate: (host, port) => readServerCertificate(host, port),
      pin: (server) => {
        pinned = server;
      },
      relaunch: () => {
        app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== CERT_RELAUNCH), CERT_RELAUNCH] });
        exit(0);
      },
      ...(process.argv.includes(CERT_RELAUNCH) ? { relaunched: true } : {}),
      loadSettings: remoteLoad,
      saveSettings: remoteSave,
      show,
      sleep,
      exit,
      log,
      strings: s,
    });

    const attachSelfcheck = (): void => {
      if (check === undefined) return;
      selfcheck = new Selfcheck({
        config: check,
        insertCss: (css) => w.webContents.insertCSS(css),
        run: (script) => w.webContents.executeJavaScript(script),
        sleep,
        address: () => running?.controller.address(),
        attached: () => local()?.attached() ?? false,
        mode: () => (connectMode() ? 'connect' : 'local'),
        childProcesses: () => childProcesses,
        log,
        after: (then) => {
          if (then === 'quit') requestQuit('self-check');
          else if (then === 'close') w.close();
        },
      });
    };

    startLocal = (): void => {
      running = { mode: 'local', controller: makeLocal() };
      attachSelfcheck();
      rebuildTray();
      // Only local mode runs the launcher, so only local mode needs it built.
      if (!existsSync(target.entry)) {
        log(`The launcher is not built: ${target.entry}`);
        show({ screen: 'error', message: s.notBuilt });
        return;
      }
      render();
      launched = true;
      void running.controller.start();
    };
    startRemote = (): void => {
      running = { mode: 'connect', controller: makeRemote() };
      attachSelfcheck();
      rebuildTray();
      launched = true;
      void running.controller.start();
    };

    render();
    void startMode({
      saved: settings.mode,
      envServer: envParsed?.ok ? env.OPENLDR_DESKTOP_SERVER : undefined,
      // Asked only when no mode is saved, so connect mode never runs the launcher.
      dataDir: async () => (existsSync(target.entry) ? ((await launcher.readStatus(target)).dataDir ?? target.dataDir) : target.dataDir),
      exists: existsSync,
    }).then((mode) => {
      if (exiting) return;
      log(`The app runs as: ${mode}.`);
      if (mode === 'connect') return startRemote();
      if (mode === 'local') {
        // An install that already holds data stays local, and is never asked.
        if (settings.mode === undefined) save({ ...loadSettings(settingsFile), mode: 'local' });
        return startLocal();
      }
      show({ screen: 'choose' });
    });
  });
}
