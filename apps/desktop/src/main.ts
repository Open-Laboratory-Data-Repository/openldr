// The Electron main process. It only wires Electron to the controller and the other modules; the
// decisions live in controller.ts, autostart.ts, locality.ts and selfcheck.ts.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, session, shell, Tray } from 'electron';
import { setAutostart, startedHidden, type AutostartDeps } from './autostart';
import { bridgeHandlers } from './bridge';
import { RETRY_CHANNEL, SCREEN_CHANNEL } from './channels';
import { DesktopController, pageState, type Screen } from './controller';
import * as launcher from './launcher';
import { frameTarget, linkTarget, mayGrantPermission, renderAfterLoad, sameOrigin, urlForLog } from './locality';
import { choosePort } from './ports';
import { Selfcheck, selfcheckConfig } from './selfcheck';
import { loadSettings, saveSettings, type Settings } from './settings';
import { pickLang, STRINGS } from './strings';

export type MainWindow = BrowserWindow;

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
  let controller: DesktopController | undefined;
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
    if (controller === undefined) return exit(0);
    void controller.quit();
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
    if (screen.screen === 'error') selfcheck?.onError(pageState(screen, strings()).title);
    render();
  };

  // Every page the app makes: links that leave OpenLDR open in the person's browser.
  app.on('web-contents-created', (_e, contents) => {
    const guard = (event: { preventDefault(): void }, url: string): void => {
      const where = linkTarget(url, controller?.address(), [pageUrl]);
      if (where === 'inside') return;
      event.preventDefault();
      if (where === 'browser') void shell.openExternal(url);
    };
    contents.on('will-navigate', (event) => guard(event, event.url));
    contents.on('will-redirect', (event) => guard(event, event.url));
    // will-navigate covers the main frame only. A frame inside a page may stay on the launcher's
    // origin or load about:blank or about:srcdoc (Studio's plugin frames); anything else is stopped.
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      if (frameTarget(event.url, controller?.address()) === 'refuse') event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (linkTarget(url, controller?.address(), [pageUrl]) === 'browser') void shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  // Studio's two calls. bridge.ts checks each sender against the launcher's address, and answers
  // only while that address is this computer. The code itself is never logged.
  const handlers = bridgeHandlers({
    address: () => controller?.bridgeAddress(),
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
    if (!existsSync(target.entry)) return show({ screen: 'error', message: strings().notBuilt });
    if (launched) return void controller?.retry();
    launched = true;
    void controller?.start();
  });

  void app.whenReady().then(() => {
    // A quit that came before this point has already exited. Start nothing.
    if (exiting) return;
    const s = strings();
    const settings = loadSettings(settingsFile);

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
      callback(mayGrantPermission(permission, details.requestingUrl, controller?.address())),
    );
    session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
      mayGrantPermission(permission, requestingOrigin, controller?.address()),
    );

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
      const address = controller?.address();
      if (address !== undefined && sameOrigin(url, address)) selfcheck?.onStudioLoaded();
    });
    w.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 is a load another load replaced. That other load reports its own end.
      if (!isMainFrame || code === -3) return;
      pageLoading = false;
      log(`A page did not load (${code} ${description}): ${urlForLog(url)}`);
      if (renderAfterLoad(current.screen === 'studio', url, pageUrl)) render();
    });
    w.webContents.on('render-process-gone', (_e, details) => log(`The window's page process ended: ${details.reason}.`));

    // The tray. The tick is the settings file's record; it is only changed by a click.
    const autostart: AutostartDeps = {
      platform: process.platform,
      home: homedir(),
      execPath: process.execPath,
      appArgs: app.isPackaged ? [] : [app.getAppPath()],
      getLoginItemSettings: () => app.getLoginItemSettings(),
      setLoginItemSettings: (v) => app.setLoginItemSettings(v),
    };
    tray = new Tray(nativeImage.createFromPath(join(here, '..', 'assets', 'tray.png')));
    tray.setToolTip(s.trayTooltip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: s.trayOpen, click: showWindow },
        {
          label: s.trayStartAtSignIn,
          type: 'checkbox',
          checked: settings.startAtSignIn,
          click: (item) => {
            try {
              setAutostart(autostart, item.checked);
              save({ ...loadSettings(settingsFile), startAtSignIn: item.checked });
            } catch (err) {
              log(`Start at sign-in was not changed: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
        },
        {
          label: s.trayOpenLogs,
          click: () => {
            const dir = controller?.dataDir();
            if (dir !== undefined) void shell.openPath(join(dir, 'logs'));
          },
        },
        { type: 'separator' },
        { label: s.trayQuit, click: () => requestQuit('tray') },
      ]),
    );
    tray.on('click', showWindow);

    controller = new DesktopController({
      readStatus: () => launcher.readStatus(target),
      startLauncher: (port, on) => launcher.startLauncher(target, port, on),
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
      strings: s,
    });
    const c = controller;

    if (check !== undefined) {
      selfcheck = new Selfcheck({
        config: check,
        insertCss: (css) => w.webContents.insertCSS(css),
        run: (script) => w.webContents.executeJavaScript(script),
        sleep,
        address: () => c.address(),
        attached: () => c.attached(),
        log,
        after: (then) => {
          if (then === 'quit') requestQuit('self-check');
          else if (then === 'close') w.close();
        },
      });
    }

    if (!existsSync(target.entry)) {
      log(`The launcher is not built: ${target.entry}`);
      show({ screen: 'error', message: s.notBuilt });
      return;
    }
    render();
    launched = true;
    void c.start();
  });
}
