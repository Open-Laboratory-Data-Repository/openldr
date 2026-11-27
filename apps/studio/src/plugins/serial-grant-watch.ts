// The studio loads the list of plugin pages once. A grant taken away on another PC does not reach
// this page by itself. So while a plugin holds a port open, the studio asks the server once a
// minute whether the plugin still holds the grant.

export const GRANT_CHECK_MS = 60_000;

/**
 * While `hasOpenPorts()` is true, asks the server every GRANT_CHECK_MS for the plugin listing.
 * Calls `onLost` when the plugin is gone from it, its version changed, or its serial is not true.
 * A fetch that fails changes nothing and is tried again a minute later. Returns the function that
 * stops the watch.
 */
export function watchGrant(input: {
  pluginId: string;
  version: string;
  hasOpenPorts(): boolean;
  fetchListing(): Promise<Array<{ id: string; version: string; devices?: { serial: boolean } }>>;
  onLost(): void;
}): () => void {
  let stopped = false;
  /** True while a question has no answer yet. A second one is not stacked on it. */
  let asking = false;
  const check = async (): Promise<void> => {
    if (stopped || asking || !input.hasOpenPorts()) return;
    asking = true;
    try {
      const listing = await input.fetchListing();
      if (stopped) return;
      const entry = listing.find((e) => e.id === input.pluginId);
      if (entry === undefined || entry.version !== input.version || entry.devices?.serial !== true) input.onLost();
    } catch {
      // The server did not answer. That says nothing about the grant.
    } finally {
      asking = false;
    }
  };
  const timer = setInterval(() => void check(), GRANT_CHECK_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
