// The app's own list of serial ports. A page in the main window asks the browser for a port; the
// browser asks the app; the app shows a small window with the ports and answers with the one a
// person pressed. Nothing here picks a port by itself, not even when the list has one row.
//
// Kept apart from Electron so its rules can be tested. main.ts wires the events to it.

import { isTrustedAddress, sameOrigin } from './locality';

export interface PortChoice { id: string; label: string; last: boolean }

/** The longest label shown. A device names itself, so its name is bounded. */
const LABEL_MAX = 200;

/**
 * The rows of the port window. `label` is the port name and its display name, such as
 * 'COM3    USB Serial Port'. `last` marks the port used last time, when it is in the list. Two
 * ports may carry one name; only the first is marked.
 */
export function portChoices(
  ports: ReadonlyArray<{ portId: string; portName: string; displayName?: string }>,
  lastPortName: string | undefined,
): PortChoice[] {
  let marked = false;
  return ports.map((p) => {
    const name = typeof p.portName === 'string' ? p.portName.trim() : '';
    const display = typeof p.displayName === 'string' ? p.displayName.trim() : '';
    const label = ([name, display].filter((part) => part !== '').join('    ') || p.portId).slice(0, LABEL_MAX);
    const last = !marked && lastPortName !== undefined && name !== '' && name === lastPortName;
    if (last) marked = true;
    return { id: p.portId, label, last };
  });
}

/**
 * Whether a request for the port list may be shown at all. True only when it comes from the
 * main window's main frame, on the trusted address's own origin: OpenLDR on this PC, or the
 * https server the app is connected to.
 */
export function maySelectPort(input: {
  isMainWindow: boolean; isMainFrame: boolean; frameUrl: string; shownAddress: string | undefined; connectMode: boolean;
}): boolean {
  if (!input.isMainWindow || !input.isMainFrame || input.shownAddress === undefined) return false;
  if (!isTrustedAddress(input.shownAddress, input.connectMode)) return false;
  return sameOrigin(input.frameUrl, input.shownAddress);
}

/** One port choice in flight. Only one at a time. */
export interface PortSelection {
  /** Starts a choice. A second one while the first is open is cancelled at once; the first stays. */
  begin(ports: PortChoice[], answer: (portId: string) => void): void;
  /** The list changed while the window is open. */
  update(ports: PortChoice[]): void;
  /** The person chose a row. Answers with its id and closes. An unknown id cancels. */
  choose(id: string): void;
  /** Cancel, the window closing, a navigation, or the main window going away. Answers ''. */
  cancel(): void;
  active(): boolean;
  /** True for a port the person pressed in this run of the app, and for no other. */
  wasChosen(portId: string): boolean;
}

/** `show` draws the rows in the port window, or closes the window when given undefined. */
export function createPortSelection(show: (ports: PortChoice[] | undefined) => void): PortSelection {
  /** The request that is open: its rows now, and the browser's answer function. */
  let open: { ports: PortChoice[]; answer: (portId: string) => void } | null = null;
  const chosen = new Set<string>();

  /** False when the window could not be drawn. */
  const draw = (ports: PortChoice[] | undefined): boolean => {
    try {
      show(ports);
      return true;
    } catch {
      return false;
    }
  };
  /** Answers the browser exactly once for the open request, then closes the window. */
  const finish = (portId: string): void => {
    const request = open;
    if (request === null) return;
    open = null;
    try { request.answer(portId); } catch { /* the page that asked has gone */ }
    draw(undefined);
  };

  return {
    begin(ports, answer) {
      if (open !== null) {
        // One list at a time. The new request is refused; the one on screen stays.
        try { answer(''); } catch { /* the page that asked has gone */ }
        return;
      }
      open = { ports, answer };
      // With no window there is no way to answer. The request is not left waiting.
      if (!draw(ports)) finish('');
    },
    update(ports) {
      if (open === null) return;
      open.ports = ports;
      if (!draw(ports)) finish('');
    },
    choose(id) {
      if (open === null) return;
      // Only a row that is on screen now. A port that left the list cannot be chosen.
      if (!open.ports.some((p) => p.id === id)) return finish('');
      chosen.add(id);
      finish(id);
    },
    cancel() {
      finish('');
    },
    active: () => open !== null,
    wasChosen: (portId) => chosen.has(portId),
  };
}
