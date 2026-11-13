/**
 * The OpenLDR desktop app's object. The app's preload script puts it on the page only when Studio
 * runs inside the app, at an address on this computer. In a browser, and on a Docker install, it
 * does not exist.
 */
export interface OpenldrDesktop {
  /** A setup code for the first administrator. Fails once an administrator exists. */
  setupCode(): Promise<string>;
  /** The app's version and the system it runs on. */
  info(): Promise<{ version: string; platform: string }>;
}

declare global {
  interface Window {
    openldrDesktop?: OpenldrDesktop;
  }
}

/** The desktop app's object, or undefined outside the app. */
export function desktopApp(): OpenldrDesktop | undefined {
  return typeof window === 'undefined' ? undefined : window.openldrDesktop;
}
