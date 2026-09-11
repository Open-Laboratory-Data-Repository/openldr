interface ShutdownDeps {
  stopUpdateCheck(): void;
  closeApp(): Promise<unknown>;
  stopWorker(): Promise<void>;
  closeIngest(): Promise<void>;
  closeContext(): Promise<void>;
}

export function createShutdown(deps: ShutdownDeps): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    if (closing) return closing;
    closing = (async () => {
      deps.stopUpdateCheck();
      await Promise.all([deps.closeApp(), deps.stopWorker()]);
      await deps.closeIngest();
      await deps.closeContext();
    })();
    return closing;
  };
}
