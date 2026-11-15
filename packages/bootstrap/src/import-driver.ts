import type { ImportCopyService } from './import-copy';
import type { ImportService } from './import-run';

// The loop that drives imports and copies in the server (spec 9.4). Only the API server starts it
// (`AppContextOptions.runImportDriver`). An `openldr` command builds an app context too, and must
// never drive: it would hold a copy for as long as the command runs, and drop it when it exits.
//
// One turn adopts the imports a server started whose driver has gone, then takes every copy that
// needs a driver. The next turn starts 5 seconds after the last one ended, so two never overlap.
// So after a power cut and a restart, a copy or an import carries on with no person pressing Resume.

/** How long the driver waits between turns. */
export const IMPORT_DRIVER_INTERVAL_MS = 5_000;

export interface ImportDriverDeps {
  copies: Pick<ImportCopyService, 'tick' | 'idle' | 'release'>;
  imports: Pick<ImportService, 'adopt'>;
  /** Default 5000. */
  intervalMs?: number;
  /** Told of each failed step. The loop goes on. */
  onError?: (err: unknown) => void;
}

export interface ImportDriver {
  /** End the loop, tell every copy drive here to let go, and wait until each has saved its
   *  position. The stored status stays, so the next server start takes the copy. Safe to call twice. */
  stop(): Promise<void>;
}

export function startImportDriver(deps: ImportDriverDeps): ImportDriver {
  const intervalMs = deps.intervalMs ?? IMPORT_DRIVER_INTERVAL_MS;
  const report = (err: unknown): void => {
    try { deps.onError?.(err); } catch { /* a broken logger must not end the loop */ }
  };
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let turn: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  /** Aborted by `stop`, so an adopt in hand resumes no more runs. */
  const ending = new AbortController();

  async function oneTurn(): Promise<void> {
    // Each step on its own, so a fault in one does not keep the other from running.
    try { await deps.imports.adopt({ signal: ending.signal }); } catch (err) { report(err); }
    if (ended) return;
    try { await deps.copies.tick(); } catch (err) { report(err); }
  }

  function schedule(delayMs: number): void {
    if (ended) return;
    timer = setTimeout(() => {
      timer = null;
      turn = oneTurn().finally(() => {
        turn = null;
        schedule(intervalMs);
      });
    }, delayMs);
  }

  // The first turn runs at once, so a copy left by the last server is looked at on start.
  schedule(0);

  return {
    stop() {
      stopping ??= (async () => {
        ended = true;
        ending.abort();
        if (timer) clearTimeout(timer);
        timer = null;
        try {
          // Called before the turn in hand ends, so a tick in flight launches nothing more.
          const releasing = deps.copies.release();
          await turn;
          await releasing;
          await deps.copies.idle();
        } catch (err) {
          report(err);
        }
      })();
      return stopping;
    },
  };
}
