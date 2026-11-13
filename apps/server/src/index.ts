import { loadConfig } from '@openldr/config';
import { guardAgainstCrashLoop } from '@openldr/bootstrap';
import { createLogger, makeCrashHandler } from '@openldr/core';
import { startServer } from './start';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger({ level: cfg.LOG_LEVEL });

  // Studio shows a banner when the bypass is on, but a server-only/headless/CI run has no
  // UI to show it. Warn first thing so an unintended bypass is visible in the log too.
  if (cfg.AUTH_DEV_BYPASS) {
    logger.warn(
      'AUTH_DEV_BYPASS is ON — API requests are NOT authenticated. Local development only; never run a real deployment in this mode.',
    );
  }

  // Durable plugin-crash capture: a crashing Extism worker can take the whole process down
  // before the in-app audit DB write flushes. These handlers synchronously append a crash
  // marker (naming the in-flight plugin via the in-flight registry) to PLUGIN_CRASH_LOG_DIR,
  // then exit — replacing Node's default crash-and-die with capture-then-die. The next boot
  // drains the markers into the audit trail (see drainCrashMarkersToAudit in start.ts).
  process.on('uncaughtException', makeCrashHandler({
    dir: cfg.PLUGIN_CRASH_LOG_DIR, kind: 'uncaughtException',
    log: (m) => logger.fatal({ marker: m }, 'uncaughtException — wrote crash marker, exiting'),
  }));
  process.on('unhandledRejection', makeCrashHandler({
    dir: cfg.PLUGIN_CRASH_LOG_DIR, kind: 'unhandledRejection',
    log: (m) => logger.fatal({ marker: m }, 'unhandledRejection — wrote crash marker, exiting'),
  }));

  // Restart circuit-breaker: before doing any expensive startup, bail out with a backoff if we're
  // in a crash loop, so a repeatedly-crashing boot slows down instead of hot-spinning + flooding.
  const tripped = await guardAgainstCrashLoop({
    dir: cfg.PLUGIN_CRASH_LOG_DIR,
    threshold: cfg.CRASH_LOOP_THRESHOLD,
    windowSec: cfg.CRASH_LOOP_WINDOW_SEC,
    backoffMs: cfg.CRASH_LOOP_BACKOFF_MS,
    backoffCapMs: cfg.CRASH_LOOP_BACKOFF_CAP_MS,
    log: (v) => logger.fatal(v, 'restart loop detected — backing off before exit'),
  });
  if (tripped) return; // guard already called process.exit; return keeps types happy under test

  const server = await startServer(cfg, logger);

  let signalReceived = false;
  const close = () => {
    if (signalReceived) return;
    signalReceived = true;
    void server.close().then(() => { process.exitCode = 0; }).catch((err) => {
      logger.error({ err }, 'server shutdown failed');
      process.exitCode = 1;
    });
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}

main().catch((err) => {
  process.stderr.write(`server failed to start: ${String(err)}\n`);
  process.exit(1);
});
