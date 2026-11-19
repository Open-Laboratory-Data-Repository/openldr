import type pg from 'pg';

export interface ProjectionWorkerDeps {
  runCycle: () => Promise<number>;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  // Optional dedicated pg client for LISTEN 'fhir_changes' wakeups (interval polling works without it).
  listenClient?: pg.Client;
}

export interface ProjectionWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

export function createProjectionWorker(deps: ProjectionWorkerDeps): ProjectionWorker {
  const intervalMs = deps.intervalMs ?? 2000;
  let stopped = false;
  let activeCycle: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  function tickOnce(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (activeCycle) return activeCycle;
    // A cycle takes one batch. While a cycle still projects something there may be more waiting,
    // so the next one starts at once (item 16). Waiting for the next notify or the 2 s timer here
    // left the warehouse 205 s behind a 20 s import check. Each cycle yields to the event loop
    // first, so a long catch-up does not starve the rest of the server.
    activeCycle = (async () => {
      for (;;) {
        if (stopped) return;
        const projected = await deps.runCycle();
        if (!(projected > 0)) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    })()
      .catch((err) => { deps.logger.error({ err }, 'projection cycle failed'); })
      .finally(() => { activeCycle = undefined; });
    return activeCycle;
  }

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);
  const onNotification = () => { if (!stopped) void tickOnce(); };
  const ready = deps.listenClient?.query('listen fhir_changes').catch(() => undefined);
  deps.listenClient?.on('notification', onNotification);

  return {
    tickOnce,
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      clearInterval(timer);
      deps.listenClient?.removeListener('notification', onNotification);
      stopPromise = (async () => {
        await ready;
        if (deps.listenClient) {
          try { await deps.listenClient.query('unlisten fhir_changes'); } catch { /* ignore */ }
        }
        await activeCycle;
      })();
      return stopPromise;
    },
  };
}
