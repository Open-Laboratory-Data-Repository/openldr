import type { FastifyInstance } from 'fastify';
import { declaredSites, getSitesOff, uiAllows, visibleSites, type AppContext } from '@openldr/bootstrap';
import { readGrant } from '@openldr/marketplace';
import type { DataScope } from '@openldr/rbac';

// A missing data limit fails closed: no facilities, never everything (operator, 2026-11-23).
// Every sign-in path sets one today, so this only guards a future path that forgets to.
const NO_FACILITIES: DataScope = { limited: true, facilities: [], districts: [], regions: [] };

interface UiPluginRow {
  id: string;
  version: string;
  enabled: boolean;
  active?: boolean;
  manifest: {
    payload?: {
      kind?: string;
      ui?: {
        entry?: string;
        sha256?: string;
        nav: { label: string; icon: string; section: string; iconPaths?: string[] };
        uiSdkVersion: string;
        declarative?: unknown;
        requiredRoles?: string[];
        requiredCapabilities?: string[];
      };
      permissions?: Array<{ key: string }>;
    };
  };
}

/**
 * True only when this stored row was granted host:serial. A row from before capabilities existed
 * has no list and gets no device. A list that cannot be read gets none either: a device is never
 * handed out on a row the server cannot check.
 */
function serialGranted(manifest: unknown): boolean {
  try {
    const grant = readGrant(manifest as Record<string, unknown>);
    return !grant.legacy && grant.capabilities.some((c) => c.kind === 'host:serial');
  } catch {
    return false;
  }
}

export function registerPluginUiRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // Any authenticated user may list plugin UIs — the sidebar uses this to build nav entries.
  // The broker (per-op) is the real security boundary, enforcing capability + role checks.
  app.get('/api/plugins/ui', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!ctx.cfg.PLUGIN_UI_ENABLED) return [];
    const caller = { roles: req.user.roles, capabilities: req.user.capabilities ?? [] };
    const rows = (await ctx.plugins.list()) as unknown as UiPluginRow[];
    const off = await getSitesOff(ctx.appSettings);
    return rows
      // The store lists every installed version. Only the active one is the plugin's UI, or a
      // plugin with two versions shows twice (two nav entries, two dashboard cards).
      .filter((r) => r.active !== false)
      .filter((r) => r.enabled && r.manifest.payload?.kind === 'plugin' && r.manifest.payload.ui)
      // Authorization boundary: hide a plugin's nav entry from callers lacking its required roles
      // (so e.g. a lab_technician never sees the lab_admin-gated DHIS2 entry).
      .filter((r) => uiAllows(r.manifest.payload!.ui!, caller).allowed)
      .map((r) => {
        const ui = r.manifest.payload!.ui!;
        return {
          id: r.id, version: r.version,
          // Named fields only. `iconPaths` is the plugin's own icon, checked as path data when the
          // manifest was parsed at install; `icon` is the fallback name.
          nav: {
            label: ui.nav.label, icon: ui.nav.icon, section: ui.nav.section,
            ...(ui.nav.iconPaths !== undefined ? { iconPaths: ui.nav.iconPaths } : {}),
          },
          uiSdkVersion: ui.uiSdkVersion,
          hasWebview: ui.entry !== undefined,
          hasDeclarative: ui.declarative !== undefined,
          declarative: ui.declarative ?? null,
          // Dashboard card and side panel, minus any an admin switched off.
          sites: visibleSites(declaredSites(r.manifest as Record<string, unknown>), off, r.id),
          // Who may open the page. Studio repeats the check above to hide the entry and refuse
          // the page; this route and the asset route below stay the real gate.
          requiredRoles: ui.requiredRoles ?? [],
          requiredCapabilities: ui.requiredCapabilities ?? [],
          // The plugin's own permission keys. The studio passes the page only these and CE's own
          // capabilities, never another plugin's keys.
          permissionKeys: (r.manifest.payload!.permissions ?? []).map((p) => p.key),
          // Devices on the PC the page may ask the studio for. Read from the active version's own
          // grant, the row this entry is built from. The studio enforces it: serial bytes never
          // come to the server.
          devices: { serial: serialGranted(r.manifest) },
        };
      });
  });

  // Serve the stored ui.html bytes — the web iframe sandbox loads this URL as its srcdoc source.
  app.get<{ Params: { id: string }; Querystring: { version?: unknown } }>('/api/plugins/:id/ui/asset', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!ctx.cfg.PLUGIN_UI_ENABLED) {
      reply.code(404);
      return reply.send({ error: 'plugin UI disabled' });
    }
    // Authorization boundary: don't serve the UI html to a caller lacking the plugin's
    // required roles. 404 (not 403) so the asset's existence isn't disclosed.
    // Check the active version's manifest: that is the version loadUi serves. The store lists
    // every installed version, and an older one may not name the capabilities the new one does.
    // No such row, or a disabled one, means no page to serve.
    const rows = (await ctx.plugins.list()) as unknown as UiPluginRow[];
    const row = rows.find((r) => r.id === req.params.id && r.active !== false);
    if (!row || !row.enabled || !uiAllows(row.manifest.payload?.ui, { roles: req.user.roles, capabilities: req.user.capabilities ?? [] }).allowed) {
      reply.code(404);
      return reply.send({ error: 'no ui asset' });
    }
    // The studio names the version its list gave it. The list also said what that version was
    // granted, such as a serial port. If another version is active by now, its page must not be
    // drawn under the old version's grant: refuse, and the studio shows no page.
    const asked = (req.query as { version?: unknown } | undefined)?.version;
    if (asked !== undefined && (typeof asked !== 'string' || asked !== row.version)) {
      reply.code(409);
      return reply.send({ error: 'plugin version changed' });
    }
    // Loaded by the version of the row just checked, never by "whatever is active now": the
    // active version can change between the two reads.
    const bytes = await ctx.plugins.loadUi(req.params.id, row.version);
    if (!bytes) {
      reply.code(404);
      return reply.send({ error: 'no ui asset' });
    }
    reply.header('content-type', 'text/html; charset=utf-8');
    // Prevent browsers from sniffing away from text/html into something executable.
    reply.header('x-content-type-options', 'nosniff');
    // Defense-in-depth: if this URL is opened directly (not via the host's sandboxed iframe),
    // the CSP sandbox keeps the plugin HTML inert (no scripts, no same-origin) at the host origin.
    reply.header('content-security-policy', 'sandbox');
    return reply.send(Buffer.from(bytes));
  });

  // Broker RPC endpoint — the iframe posts messages via the host SDK which relays them here.
  // The broker itself enforces capability + global policy + role-gate; this route just
  // authenticates the caller and forwards. It never throws (broker returns ok/error shapes).
  app.post<{ Params: { id: string }; Body: { op?: unknown } }>('/api/plugins/:id/broker', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    const op = (req.body as { op?: unknown } | undefined)?.op;
    if (op === undefined || op === null) {
      reply.code(400);
      return reply.send({ ok: false, error: 'missing op' });
    }
    // The broker parses + validates the op itself (zod schema + size bounds), returning a
    // structured invalid-operation error for anything malformed.
    // The data limit goes too: a limited caller may make no report or data call (roles part 3).
    const principal = { id: req.user.id, roles: req.user.roles, username: req.user.username, displayName: req.user.displayName, capabilities: req.user.capabilities ?? [], dataScope: req.user.dataScope ?? NO_FACILITIES };
    return ctx.pluginBroker.handle(req.params.id, principal, op);
  });
}
