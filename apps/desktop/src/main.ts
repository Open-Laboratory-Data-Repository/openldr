// The Electron main process. Task 4 writes it. The type import checks, at typecheck time, that
// Electron's own Node types and the repo's Node types load together.
import type { BrowserWindow } from 'electron';

export type MainWindow = BrowserWindow;
