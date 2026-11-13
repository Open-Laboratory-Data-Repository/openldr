// The preload script. It runs sandboxed, with context isolation on. On the app's own file: pages
// it gives the page one object, `window.openldrDesktopPage`. Pages at any other address get
// nothing from here.

import { contextBridge, ipcRenderer } from 'electron';
import { RETRY_CHANNEL, SCREEN_CHANNEL } from './channels';
import type { PageState } from './controller';

if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('openldrDesktopPage', {
    onScreen(cb: (s: PageState) => void): void {
      ipcRenderer.on(SCREEN_CHANNEL, (_event, s: PageState) => cb(s));
    },
    retry(): void {
      ipcRenderer.send(RETRY_CHANNEL);
    },
  });
}
