import { z } from 'zod';

export const SyncModeSchema = z.enum(['push', 'pull', 'bidirectional']);
export type SyncMode = z.infer<typeof SyncModeSchema>;

/** Local loopback hosts for which plaintext http:// is always tolerated (dev/test). */
function isLoopbackHttp(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|\[0:0:0:0:0:0:0:1\])(:\d+)?(\/|$)/i.test(url);
}

/**
 * Enabled sync posts the client secret to the token endpoint and ships bearer-authenticated FHIR /
 * reference deltas (PHI-adjacent) to central — so plaintext http:// would expose credentials and
 * clinical data on the wire. When sync is ENABLED we therefore require https:// for `centralUrl` and
 * `oidcIssuer`, with two carve-outs: (1) loopback hosts (localhost/127.0.0.1/[::1]) for dev/test, and
 * (2) an explicit, deliberately-loud override — env `SYNC_ALLOW_INSECURE_TRANSPORT=true` — for trusted
 * LAN bring-up. Everything else (http:// to a routable host, with no override) is rejected. A disabled
 * config is not transport-checked (only the http(s) format check applies) so a placeholder can be saved.
 */
export function isInsecureTransportAllowed(): boolean {
  return String(process.env.SYNC_ALLOW_INSECURE_TRANSPORT ?? '').trim().toLowerCase() === 'true';
}

function requireSecureUrl(url: string): boolean {
  return /^https:\/\//i.test(url) || isLoopbackHttp(url) || isInsecureTransportAllowed();
}

/**
 * Input accepted by setSyncConfig / PUT /api/settings/sync / CLI. Writes the six discrete `sync.*`
 * keys the workers read. `clientSecret` is optional & WRITE-ONLY: a blank/absent value leaves the
 * stored (encrypted) secret unchanged so a field-level patch or a UI submit that doesn't re-type the
 * secret preserves it.
 */
export const SyncConfigInputSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: SyncModeSchema.default('bidirectional'),
    centralUrl: z.string().default(''),
    siteId: z.string().default(''),
    oidcIssuer: z.string().default(''),
    clientId: z.string().default(''),
    clientSecret: z.string().optional(),
    intervalMinutes: z.number().int().positive().max(1440).default(15),
    // Lab-side enrollment keys (S5). `signingPrivateKey` is the lab's OWN signing key (DER hex),
    // handled like clientSecret: optional & WRITE-ONLY — a blank/absent value leaves the stored
    // (encrypted) key unchanged. `centralPublicKey` is central's public key (DER hex): plaintext and
    // readable (a public key is not a secret), but OPTIONAL so an ABSENT field preserves the stored
    // pinned key. Without this, a client whose input contract omits the field (e.g. a Studio settings
    // save) would default it to '' and wipe the enrollment-pinned key, breaking later offline pull
    // bundle verification. An explicit '' still clears it.
    signingPrivateKey: z.string().optional(),
    centralPublicKey: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.centralUrl && !/^https?:\/\//i.test(c.centralUrl))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['centralUrl'], message: 'centralUrl must be an http(s) URL' });
    if (c.oidcIssuer && !/^https?:\/\//i.test(c.oidcIssuer))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['oidcIssuer'], message: 'oidcIssuer must be an http(s) URL' });
    if (c.enabled) {
      for (const [f, v] of [
        ['centralUrl', c.centralUrl],
        ['siteId', c.siteId],
        ['oidcIssuer', c.oidcIssuer],
        ['clientId', c.clientId],
      ] as const) {
        if (!v) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f], message: `${f} is required when sync is enabled` });
      }
      // Enabled sync carries credentials + PHI-adjacent deltas: require https:// (loopback and an
      // explicit SYNC_ALLOW_INSECURE_TRANSPORT=true override excepted — see requireSecureUrl).
      const insecureMsg = ' requires https:// when sync is enabled (set SYNC_ALLOW_INSECURE_TRANSPORT=true only for trusted-LAN bring-up)';
      if (c.centralUrl && /^https?:\/\//i.test(c.centralUrl) && !requireSecureUrl(c.centralUrl))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['centralUrl'], message: `centralUrl${insecureMsg}` });
      if (c.oidcIssuer && /^https?:\/\//i.test(c.oidcIssuer) && !requireSecureUrl(c.oidcIssuer))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['oidcIssuer'], message: `oidcIssuer${insecureMsg}` });
    }
  });
export type SyncConfigInput = z.infer<typeof SyncConfigInputSchema>;

/** Output of getSyncConfig / GET /api/settings/sync / `openldr sync show` — never carries the secret
 *  value, only a boolean indicating whether one is set. */
export interface SyncConfigView {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  oidcIssuer: string;
  clientId: string;
  clientSecretSet: boolean;
  intervalMinutes: number;
  /** Whether a lab signing private key is stored (S5). Write-only: the value is never returned. */
  signingKeySet: boolean;
  /** Central's public key (DER hex), readable — a public key is not a secret (S5). */
  centralPublicKey: string;
}
