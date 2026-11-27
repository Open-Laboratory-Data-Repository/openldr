// The IPC channel names the main process and the preload share.

/** Main to the app's own page: a PageState to show. */
export const SCREEN_CHANNEL = 'openldr-desktop:screen';
/** The app's own page to main: the person asked to start again. */
export const RETRY_CHANNEL = 'openldr-desktop:retry';
/** The app's own page to main: a button was pressed. Carries { id: PageAction; value?: string }. */
export const ACTION_CHANNEL = 'openldr-desktop:action';
/** The preload asks, before it gives a page anything: does the app show another PC's OpenLDR? Answered at once with true or false. */
export const CONNECT_MODE_CHANNEL = 'openldr-desktop:connect-mode';
