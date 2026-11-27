import type { WorkflowItem, BinaryRef } from './items';

export interface RunPluginNodeInput {
  pluginId: string;
  /** The node decl id within the plugin (NOT the `${pluginId}:${id}` composite). */
  nodeId: string;
  config: Record<string, unknown>;
  items: WorkflowItem[];
}
export interface RunPluginNodeOutput {
  items: WorkflowItem[];
  meta?: Record<string, unknown>;
}

export interface RunFormValidateInput {
  formId: string;
  items: WorkflowItem[];
}
export interface FormValidateInvalid {
  index: number;
  errors: Array<{ fieldId: string; reason: string }>;
}
export interface RunFormValidateOutput {
  items: WorkflowItem[];
  meta: { formId: string; validated: number; invalid: FormValidateInvalid[] };
}

/**
 * Input of the Map to FHIR node. `mappings` are saved mappings; the host narrows them with the
 * forms package's schema, which this package does not import.
 */
export interface RunMapToFhirInput {
  items: WorkflowItem[];
  config: { targetId: string; formIds: string[]; mappings: unknown[] };
}
/**
 * `out` holds one item per FHIR record. A `held` item is `{ item, reason, shape?, field? }`.
 * `heldIndexes[i]` is the input index of `held[i]`. `meta.heldReasons` is the first 20 reasons,
 * in input order. `meta.notes` lists, once each and at most 20, what mapped items held that was not
 * stored: a column of nested data no mapping reads, or a unit with no number. Names only, no values.
 */
export interface RunMapToFhirOutput {
  out: WorkflowItem[];
  held: WorkflowItem[];
  heldIndexes: number[];
  meta: { fhir: number; form: number; mapped: number; held: number; heldReasons: string[]; notes: string[] };
}

export interface RunPersistStoreInput {
  items: WorkflowItem[];
  source?: string;
}
export interface RunPersistStoreOutput {
  items: WorkflowItem[];
  meta: {
    persisted: number;
    batchId: string;
    flattened: { written: number; skipped: number; degraded: number; deferred: number };
    resourceTypes: string[];
  };
}

export interface SqlResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}
export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface ExportArtifactInput {
  format: 'csv' | 'xlsx' | 'pdf';
  filename?: string;
  title?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}
export interface ExportArtifactResult {
  objectKey: string;
  format: string;
  byteSize: number;
}
/** Capabilities the server injects so source handlers can reach lab data. */
export interface WorkflowServices {
  runSql(sql: string): Promise<SqlResult>;
  fhirQuery(resourceType: string, limit: number): Promise<{ resources: unknown[] }>;
  httpFetch(req: HttpRequest): Promise<HttpResponse>;
  materializeDataset(
    name: string,
    columns: { key: string; label: string }[],
    rows: Record<string, unknown>[],
    workflowId: string | null,
  ): Promise<{ dataset: string; rowCount: number }>;
  exportArtifact(input: ExportArtifactInput): Promise<ExportArtifactResult>;
  /** Execute a plugin-contributed workflow node. Injected at bootstrap; absent in
   *  pure-engine tests and legacy paths. */
  runPluginNode?(input: RunPluginNodeInput): Promise<RunPluginNodeOutput>;
  /** Validate items against a form definition → FHIR resource items. Host-injected. */
  validateForm?(input: RunFormValidateInput): Promise<RunFormValidateOutput>;
  /** Turn FHIR, form answers or mapped rows into FHIR records, and hold the rest. Host-injected. */
  mapToFhir?(input: RunMapToFhirInput): Promise<RunMapToFhirOutput>;
  /** Persist FHIR resource items + emit data.persisted. Host-injected. */
  persistStore?(input: RunPersistStoreInput): Promise<RunPersistStoreOutput>;
  loadDataset(name: string): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
  /** Run a raw SQL query against a host database connector → rows. Host-injected (database nodes). */
  runConnectorSql?(input: { connectorId: string; sql: string }): Promise<SqlResult>;
  /** Run a MongoDB operation against a host connector. Host-injected. */
  runConnectorMongo?(input: { connectorId: string; operation: string; collection: string; query: unknown }): Promise<{ rows: Record<string, unknown>[]; meta?: Record<string, unknown> }>;
  /** Run a Redis operation against a host connector. Host-injected. */
  runConnectorRedis?(input: { connectorId: string; operation: string; key: string; value?: string; ttlSeconds?: number }): Promise<{ result: unknown }>;
  /** Read raw bytes for a stored BinaryRef objectKey. Host-injected (binary nodes). */
  readBinary?(objectKey: string): Promise<Uint8Array>;
  /** Persist raw bytes as a run artifact under workflow-artifacts/ → BinaryRef. Host-injected (binary nodes). */
  writeBinary?(input: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef>;
  /** Resolve a named secret from a connector's decrypted config (report passwords etc.). Host-injected. */
  resolveSecret?(input: { connectorId: string; key: string }): Promise<string | undefined>;
  /** Resolve a sealed workflow-secret ref (`{ secretRef }`) → plaintext (SEC-06). Host-injected;
   *  keeps `@openldr/workflows` crypto-key-free. Used by the HTTP node to open a ref-valued
   *  `config.headers` blob before the fetch. */
  resolveWorkflowSecret?(ref: string): Promise<string | undefined>;
  /** Send an email via a host connector (smtp/gmail/outlook). Host-injected. */
  runConnectorEmail?(input: { connectorId: string; to: string; subject: string; body: string; html?: boolean; cc?: string; attachments?: Array<{ filename: string; content: Uint8Array; contentType?: string }> }): Promise<{ messageId: string; accepted: string[]; rejected: string[] }>;
  /** Run an SFTP operation against a host connector. Host-injected. */
  runConnectorSftp?(input: { connectorId: string; operation: string; remotePath: string; toPath?: string; bytes?: Uint8Array }): Promise<{ bytes?: Uint8Array; fileName?: string; entries?: { name: string; size: number; type: string }[]; ok?: boolean }>;
  /** Run another saved workflow as a sub-workflow → its terminal items. Host-injected (execute-workflow node). */
  runSubWorkflow?(input: { workflowId: string; input: WorkflowItem[]; callStack: string[] }): Promise<{ items: WorkflowItem[]; status: 'completed' | 'failed' }>;
  /** Read a host file within the sandbox root → bytes. Host-injected (read-write-file node). */
  hostFileRead?(path: string): Promise<{ bytes: Uint8Array }>;
  /** Write bytes to a host file within the sandbox root. Host-injected. */
  hostFileWrite?(path: string, bytes: Uint8Array): Promise<{ byteSize: number }>;
  /** List a host directory within the sandbox root. Host-injected. */
  hostFileList?(path: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; size: number }[] }>;
  /** Delete a host file (not a directory) within the sandbox root. Host-injected. */
  hostFileDelete?(path: string): Promise<{ ok: true }>;
}

export function parseAllowlist(raw: string): string[] {
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * What an HTTP step may call. `hosts` match the host name on any port and scheme. `origins` match
 * scheme, host and port exactly, such as 'http://127.0.0.1:3000'.
 */
export interface HttpAllowRule {
  hosts: string[];
  origins: string[];
}

interface Allowed {
  hosts: Set<string>;
  origins: Set<string>;
}

/**
 * A host in the one form used to compare: lower case, and an IPv6 address without brackets and
 * in the short form a URL gives it. A person may write `0:0:0:0:0:0:0:1` or `[::1]`; the URL of a
 * request always gives `[::1]`. Without this, an address typed in long form would never match.
 */
export function canonicalHost(raw: string): string {
  const text = raw.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!text.includes(':')) return text;
  try {
    return new URL(`http://[${text}]`).hostname.replace(/^\[(.*)\]$/, '$1');
  } catch {
    return text;
  }
}

function prepare(allow: string | HttpAllowRule): Allowed {
  const rule = typeof allow === 'string' ? { hosts: parseAllowlist(allow), origins: [] } : allow;
  const origins = new Set<string>();
  for (const raw of rule.origins) {
    try {
      const u = new URL(raw);
      // `origin` is the URL's own normal form: lower case, no path, no default port.
      if (u.protocol === 'http:' || u.protocol === 'https:') origins.add(u.origin);
    } catch {
      // Not a URL: it allows nothing.
    }
  }
  return { hosts: new Set(rule.hosts.map(canonicalHost).filter(Boolean)), origins };
}

const MAX_REDIRECTS = 5;

/**
 * Validate a single hop's URL: scheme must be http/https, and either the hostname is an allowed
 * host or the origin (scheme, host and port) is an allowed origin. Returns the parsed URL.
 *
 * NOTE (residual risk): the check is host-based and operator-controlled. It
 * does NOT defend against DNS-rebinding — an allow-listed hostname that resolves
 * to an internal/loopback IP would still pass. Resolve-and-pin (checking the
 * resolved IP against private/link-local ranges) is a possible future hardening.
 */
function validateHop(rawUrl: string, allow: Allowed): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`HTTP Request: invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`HTTP Request: unsupported URL scheme: ${parsed.protocol}`);
  }
  const host = canonicalHost(parsed.hostname);
  if (!allow.hosts.has(host) && !allow.origins.has(parsed.origin)) throw new Error(`HTTP host not allowed: ${host}`);
  return parsed;
}

/** Drop sensitive auth headers (case-insensitively) before a hop to another origin. */
function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    // Strip Authorization, Cookie, and any "x-...token" style auth headers.
    if (lower === 'authorization' || lower === 'cookie' || lower === 'proxy-authorization') continue;
    if (lower.startsWith('x-') && lower.includes('token')) continue;
    out[k] = v;
  }
  return out;
}

/** Drop body + Content-Type headers (when a 301/302/303 downgrades to GET). */
function dropBodyHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type') continue;
    out[k] = v;
  }
  return out;
}

/**
 * fetch wrapper that rejects any URL the allow rule does not cover (SSRF guard). `allow` is a rule,
 * or the old comma-separated host list, which means those hosts and no origins. Redirects are followed MANUALLY so every hop — the initial URL
 * and each redirect target — is revalidated against the allow-list and scheme
 * check; fetch is never allowed to auto-follow. `fetchImpl` is injectable for
 * tests.
 */
export async function guardedFetch(
  req: HttpRequest,
  allowRule: string | HttpAllowRule,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpResponse> {
  if (!req.url) throw new Error('HTTP Request: URL is required');
  const allow = prepare(allowRule);

  let currentUrl = validateHop(req.url, allow);
  let method = (req.method ?? 'GET').toUpperCase();
  let headers: Record<string, string> = { ...(req.headers ?? {}) };
  let body: string | undefined;
  if (['POST', 'PUT', 'PATCH'].includes(method) && req.body !== undefined) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  }

  let res: Response | undefined;
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) throw new Error('HTTP Request: too many redirects');

    // `redirect: 'manual'` ensures fetch never auto-follows — we revalidate each hop.
    res = await fetchImpl(currentUrl.toString(), { method, headers, body, redirect: 'manual' });

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get('location') : null;
    // 3xx with no Location → treat as the final response.
    if (!isRedirect || !location) break;

    // Resolve the (possibly relative) Location against the current hop, then
    // revalidate scheme + host. This is the core fix: a redirect to a
    // non-allow-listed host is rejected before it is ever fetched.
    const nextUrl = new URL(location, currentUrl);
    const validated = validateHop(nextUrl.toString(), allow);

    // Standard redirect method semantics.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== 'GET' && method !== 'HEAD')) {
      // 303 always → GET; 301/302 on a non-idempotent method → GET. Drop the body.
      method = 'GET';
      body = undefined;
      headers = dropBodyHeaders(headers);
    }
    // 307/308 (and 301/302 already-GET) preserve method + body as-is.

    // A hop to another origin (scheme, host or port): strip sensitive request headers first.
    // Another port of the same host is another program, and http is not https.
    if (validated.origin !== currentUrl.origin) {
      headers = stripSensitiveHeaders(headers);
    }

    currentUrl = validated;
  }

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { responseHeaders[k] = v; });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: responseHeaders, data };
}
