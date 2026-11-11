import { pino, destination, type Logger } from 'pino';

export type { Logger };

// Keys whose values may carry secrets (DSNs, passwords, tokens, S3 keys). pino redacts any
// log object property matching these paths. The plain key (e.g. `password`) catches a
// top-level property; the `*.` form (e.g. `*.password`) catches it one nesting level deep.
export const redactPaths = [
  'password', '*.password',
  'pwd', '*.pwd',
  'connectionString', '*.connectionString',
  'secretAccessKey', '*.secretAccessKey',
  'accessKeyId', '*.accessKeyId',
  'authorization', '*.authorization', 'Authorization', '*.Authorization',
];

/**
 * Redacts the value of the `access_token` query parameter from a URL string.
 * Handles it appearing as `?access_token=...` or `&access_token=...`.
 * On /api/patients URLs it also redacts the `search` value (a patient identifier).
 * All other query parameters are preserved unchanged.
 */
export function redactUrl(url: string): string {
  const out = url.replace(/(?<=[?&]access_token=)[^&]*/g, '[REDACTED]');
  // The patient list takes an identifier in `search`; keep it out of request logs.
  return out.startsWith('/api/patients') ? out.replace(/(?<=[?&]search=)[^&]*/g, '[redacted]') : out;
}

// Where every logger made after this point writes: 1 is stdout, 2 is stderr. The server keeps
// stdout. The CLI prints its results on stdout (`--json` output is meant to be piped), so it moves
// logs to stderr before it builds a context; otherwise an info line lands in front of the JSON.
let logFd: 1 | 2 = 1;

export function sendLogsToStderr(): void {
  logFd = 2;
}

export function logDestinationFd(): 1 | 2 {
  return logFd;
}

export function createLogger(opts?: { level?: string; name?: string }): Logger {
  const options = {
    name: opts?.name ?? 'openldr',
    level: opts?.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: redactPaths, censor: '[redacted]' },
    serializers: {
      // Fastify's default req serializer logs req.url verbatim, exposing any
      // `access_token` query parameter value. This override redacts it before
      // the value reaches the log stream. Fastify merges loggerInstance.serializers
      // (via pino[serializersSym]) into the child logger it creates — so this
      // serializer wins over Fastify's built-in default.
      req(req: { method?: string; url?: string; host?: string; ip?: string; socket?: { remotePort?: number }; headers?: Record<string, string> }) {
        return {
          method: req.method,
          url: req.url != null ? redactUrl(req.url) : req.url,
          version: req.headers?.['accept-version'],
          host: req.host,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        };
      },
    },
  };
  return logFd === 2 ? pino(options, destination({ fd: 2, sync: true })) : pino(options);
}
