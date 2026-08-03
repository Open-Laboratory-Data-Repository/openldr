import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FEATURE_FLAGS } from '@openldr/config';
import { seedDatabase, seedDefaultConnector, seedEssentials, type FormSeedTarget } from './seed';
import type { DbContext } from './db-context';

// In-memory fakes so we exercise the real seedDatabase logic without a database.
function fakeApp(cfg: FormSeedTarget['cfg'] = {}) {
  const forms: { id: string; name: string; status: string }[] = [];
  // `enabled` is modelled because the seed now REPAIRS it: an existing but disabled `wf-ingest`
  // is re-enabled on boot (form capture submits through it). A fake that dropped the flag would
  // keep passing while that behaviour broke.
  const workflows: { id: string; name: string; definition?: unknown; enabled?: boolean }[] = [];
  const connectors: { id: string; name: string; type: string | null; config: Record<string, string> }[] = [];
  const dashboards: Record<string, unknown>[] = [];
  // Terminology stores modelled just enough to exercise real idempotency: value sets deduped by
  // url (as importFhirCatalog does), UCUM concepts deduped by (system, code) (as the loader does).
  const valueSets: { url: string; publisherId: string | null }[] = [];
  const concepts = new Set<string>(); // `${system}\t${code}`
  const terminology: FormSeedTarget['terminology'] = {
    ops: {
      lookup: async (system: string, code: string) => ({ found: concepts.has(`${system}\t${code}`) }),
    },
    admin: {
      valueSets: {
        list: async (publisherId?: string) =>
          valueSets.filter((v) => !publisherId || v.publisherId === publisherId) as never,
        getByUrl: async (url: string) => (valueSets.find((v) => v.url === url) ?? null) as never,
        save: async (input: { url: string; publisherId?: string | null }) => {
          valueSets.push({ url: input.url, publisherId: input.publisherId ?? null } as never);
          return {} as never;
        },
        importFhirCatalog: async (resource: unknown) => {
          const cat = resource as { valueSets?: { url: string }[] };
          let imported = 0;
          let skipped = 0;
          for (const vs of cat.valueSets ?? []) {
            if (valueSets.some((x) => x.url === vs.url)) { skipped += 1; continue; }
            valueSets.push({ url: vs.url, publisherId: 'pub-hl7-fhir' });
            imported += 1;
          }
          return { imported, skipped, valueSet: null } as never;
        },
      },
    },
    loaders: {
      resource: async (json: unknown) => {
        const cs = json as { url?: string; concept?: { code: string }[] };
        let conceptsLoaded = 0;
        for (const c of cs.concept ?? []) {
          const key = `${cs.url}\t${c.code}`;
          if (!concepts.has(key)) { concepts.add(key); conceptsLoaded += 1; }
        }
        return { conceptsLoaded };
      },
    },
  };
  const settings = new Map<string, string>();
  const reportDesigns: { id: string }[] = [];
  const reportDefs: { id: string; designId?: string }[] = [];
  const app: FormSeedTarget = {
    appSettings: {
      get: async (key: string) => {
        const value = settings.get(key);
        return value !== undefined ? { key, value, updatedAt: new Date(), updatedBy: 'system' } : null;
      },
      set: async (key: string, value: string) => { settings.set(key, value); },
    },
    forms: {
      list: async () => forms as never,
      // Honour an explicit id exactly like the real store (FormInput.id): seeded forms use a
      // DETERMINISTIC id so central's and a lab's copies converge instead of duplicating over sync.
      // A fake that ignored it would keep passing while the real behaviour changed underneath.
      create: async (f: { id?: string; name: string; status?: string }) => {
        const created = { id: f.id ?? `form-${forms.length}`, name: f.name, status: f.status ?? 'draft' };
        forms.push(created);
        return created as never;
      },
      setStatus: async (id: string, status: string) => {
        const f = forms.find((x) => x.id === id);
        if (f) f.status = status;
        return f as never;
      },
    },
    workflows: {
      store: {
        list: async () => workflows as never,
        create: async (w: { id: string; name: string; definition?: unknown; enabled?: boolean }) => {
          workflows.push({ id: w.id, name: w.name, definition: w.definition, enabled: w.enabled });
          return w as never;
        },
        // Whole-row replace, exactly like the real store (`update(id, w)` takes a full Workflow).
        update: async (id: string, w: { name: string; definition?: unknown; enabled?: boolean }) => {
          const idx = workflows.findIndex((x) => x.id === id);
          const next = { id, name: w.name, definition: w.definition, enabled: w.enabled };
          if (idx >= 0) workflows[idx] = next; else workflows.push(next);
          return next as never;
        },
      },
    },
    connectors: {
      list: async () => connectors as never,
      create: async (input: { id: string; name: string; type?: string | null; config: Record<string, string> }) => {
        connectors.push({ id: input.id, name: input.name, type: input.type ?? null, config: input.config });
      },
      getDecryptedConfig: async (id: string) => connectors.find((c) => c.id === id)?.config ?? {},
    },
    dashboards: {
      store: {
        get: async (id: string) => dashboards.find((d) => d.id === id) as never,
        create: async (d: Record<string, unknown> & { id: string }) => {
          if (!dashboards.some((x) => x.id === d.id)) dashboards.push(d);
          return d as never;
        },
        update: async (id: string, d: Record<string, unknown> & { id: string }) => {
          const idx = dashboards.findIndex((x) => x.id === id);
          const next = { ...d, id };
          if (idx >= 0) dashboards[idx] = next; else dashboards.push(next);
          return next as never;
        },
      },
    },
    reportDesigns: {
      get: async (id: string) => reportDesigns.find((r) => r.id === id) as never,
      create: async (d: { id: string }) => {
        if (!reportDesigns.some((x) => x.id === d.id)) reportDesigns.push({ id: d.id });
        return d as never;
      },
      remove: async (id: string) => {
        const idx = reportDesigns.findIndex((x) => x.id === id);
        if (idx !== -1) reportDesigns.splice(idx, 1);
      },
      update: async (id: string, d: { id: string }) => ({ ...d, id }) as never,
    },
    reportDefs: {
      get: async (id: string) => reportDefs.find((r) => r.id === id) as never,
      update: async (id: string, r: { id: string }) => ({ ...r, id }) as never,
      create: async (r: { id: string; designId?: string }) => {
        if (!reportDefs.some((x) => x.id === r.id)) reportDefs.push({ id: r.id, designId: r.designId });
        return r as never;
      },
      list: async () => reportDefs as never,
    },
    terminology,
    cfg,
  };
  return { app, workflows, connectors, dashboards, reportDesigns, reportDefs, valueSets, concepts, settings };
}

const fakeDb = { persist: vi.fn(async (r: { id: string }) => ({ flattened: JSON.stringify(r) })) } as unknown as DbContext;

describe('seedDatabase — default workflows', () => {
  // Seeded forms now carry a deterministic id derived from the sample's stable schema id
  // ('sample-order' → 'form-sample-order'), so central and every lab agree on it.
  const ORDER_FORM_ID = 'form-sample-order';

  it('seeds the Ingest + reactive default workflows', async () => {
    const { app, workflows } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.workflowsSeeded).toBe(2);
    expect(workflows.map((w) => w.id).sort()).toEqual(['wf-ingest', 'wf-sample-reactive']);
  });

  it('injects the seeded "Lab order" form id into the Ingest Form Validate node', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const ingest = workflows.find((w) => w.id === 'wf-ingest');
    const def = ingest?.definition as { nodes: { data: { action?: string; config?: { formId?: string } } }[] };
    const fv = def.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config?.formId).toBe(ORDER_FORM_ID);
  });

  it('is idempotent — re-running seeds nothing new', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.workflowsSeeded).toBe(0);
    expect(workflows).toHaveLength(2);
  });

  it('ships wf-ingest enabled on a fresh install', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    expect(workflows.find((w) => w.id === 'wf-ingest')?.enabled).toBe(true);
  });
});

// Seeding is create-if-absent by id, so an install that already has the `wf-ingest` row keeps
// whatever enabled state it has — and earlier versions shipped it DISABLED. Hand capture submits
// through this workflow, so a disabled row means every form submission 409s on an upgrade.
describe('seedEssentials — repairing a disabled wf-ingest on an upgrade', () => {
  /** An existing install: the row is present, disabled, with a graph the operator has edited. */
  function existingDisabledIngest(): { id: string; name: string; definition: unknown; enabled: boolean } {
    return {
      id: 'wf-ingest',
      name: 'Ingest (renamed by the operator)',
      definition: { nodes: [{ id: 'operator-node', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Mine' } }], edges: [] },
      enabled: false,
    };
  }

  it('enables an existing disabled wf-ingest', async () => {
    const { app, workflows } = fakeApp();
    workflows.push(existingDisabledIngest());

    const res = await seedEssentials(app);

    // Nothing was CREATED for wf-ingest — the row already existed; only wf-sample-reactive is new.
    expect(res.workflowsSeeded).toBe(1);
    expect(workflows.find((w) => w.id === 'wf-ingest')?.enabled).toBe(true);
  });

  it('does NOT overwrite the operator\'s customised graph while enabling it', async () => {
    const { app, workflows } = fakeApp();
    workflows.push(existingDisabledIngest());

    await seedEssentials(app);

    const ingest = workflows.find((w) => w.id === 'wf-ingest')!;
    const def = ingest.definition as { nodes: { id: string }[] };
    expect(def.nodes.map((n) => n.id)).toEqual(['operator-node']);
    expect(ingest.name).toBe('Ingest (renamed by the operator)');
  });

  it('leaves an already-enabled wf-ingest untouched', async () => {
    const { app, workflows } = fakeApp();
    const updates: string[] = [];
    workflows.push({ ...existingDisabledIngest(), enabled: true });
    const realUpdate = app.workflows.store.update;
    app.workflows.store.update = (async (id: string, w: never) => { updates.push(id); return realUpdate(id, w); }) as never;

    await seedEssentials(app);

    expect(updates).toEqual([]);
    expect(workflows.find((w) => w.id === 'wf-ingest')?.enabled).toBe(true);
  });

  // wf-sample-reactive is a demo with nothing depending on it, so disabling it is a choice the
  // operator is entitled to keep.
  it('does not re-enable a disabled wf-sample-reactive', async () => {
    const { app, workflows } = fakeApp();
    workflows.push({ id: 'wf-sample-reactive', name: 'On Ingest Persisted → Log', definition: { nodes: [], edges: [] }, enabled: false });

    await seedEssentials(app);

    expect(workflows.find((w) => w.id === 'wf-sample-reactive')?.enabled).toBe(false);
  });
});

describe('seedEssentials — always-seeded minimum (SEED_ON_START off)', () => {
  it('seeds ONLY the Users + Lab order forms and the two default workflows', async () => {
    const { app, workflows } = fakeApp();
    const res = await seedEssentials(app);
    // Two essential forms, both published; the two other sample forms (facility/patient) are NOT
    // seeded here — those are demo-only and belong to the full SEED_ON_START seed.
    expect(res.formsSeeded).toBe(2);
    const forms = await app.forms.list();
    expect(forms.map((f) => f.name).sort()).toEqual(['Lab order', 'Users']);
    expect(forms.every((f) => f.status === 'published')).toBe(true);
    // Both default workflows seeded; the Ingest workflow is bound to the seeded Lab order form's id.
    expect(res.workflowsSeeded).toBe(2);
    // No TARGET_DATABASE_URL/SECRETS_ENCRYPTION_KEY in this fakeApp() → the default connector is
    // self-guarded and skipped (0), without throwing.
    expect(res.connectorsSeeded).toBe(0);
    expect(workflows.map((w) => w.id).sort()).toEqual(['wf-ingest', 'wf-sample-reactive']);
    const ingest = workflows.find((w) => w.id === 'wf-ingest');
    const def = ingest?.definition as { nodes: { data: { action?: string; config?: { formId?: string } } }[] };
    const orderForm = forms.find((f) => f.name === 'Lab order')!;
    expect(def.nodes.find((n) => n.data.action === 'form-validate')?.data.config?.formId).toBe(orderForm.id);
  });

  it('is idempotent — re-running seeds nothing new', async () => {
    const { app, workflows } = fakeApp();
    await seedEssentials(app);
    const res2 = await seedEssentials(app);
    expect(res2.formsSeeded).toBe(0);
    expect(res2.workflowsSeeded).toBe(0);
    expect((await app.forms.list())).toHaveLength(2);
    expect(workflows).toHaveLength(2);
  });

  it('seeds the default connector (with config) but no dashboard/terminology demo data', async () => {
    const { app, connectors, dashboards, valueSets } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://u:p@h:5432/d' });
    const res = await seedEssentials(app);
    // The connector is an essential — a fresh SEED_ON_START=false install must be able to query.
    expect(res.connectorsSeeded).toBe(1);
    expect(connectors).toHaveLength(1);
    expect(connectors[0].name).toBe('Target Warehouse (Postgres)');
    // Dashboards + terminology stay opt-in demo data, seeded only by the full SEED_ON_START seed.
    expect(dashboards).toHaveLength(0);
    expect(valueSets).toHaveLength(0);
  });

  it('seeds the connector idempotently by name — re-running the essentials adds nothing', async () => {
    const { app, connectors } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://u:p@h:5432/d' });
    await seedEssentials(app);
    const res2 = await seedEssentials(app);
    expect(res2.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(1);
  });

  describe('drift warning against TARGET_DATABASE_URL', () => {
    // The connector is written once and never re-synced, so a TARGET_DATABASE_URL that moves
    // afterwards leaves reports pointing at the OLD server — failing at connection time, far from
    // the config that caused it. These pin that the disagreement is announced at boot.
    const warned = () => (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(' ')).join('\n');

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('says nothing when the stored connector still matches the environment', async () => {
      const { app } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://u:p@h:5433/d' });
      await seedEssentials(app);
      await seedEssentials(app);
      expect(warned()).not.toMatch(/no longer matches TARGET_DATABASE_URL/);
    });

    it('names each diverging field, with both values, when the URL has moved', async () => {
      // The exact shape of this failure: seeded against one port, environment later points at another.
      const { app } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://u:p@h:5432/d' });
      await seedEssentials(app);
      app.cfg.TARGET_DATABASE_URL = 'postgres://u:p@h:5433/openldr_target';
      await seedEssentials(app);
      const out = warned();
      expect(out).toMatch(/no longer matches TARGET_DATABASE_URL/);
      expect(out).toMatch(/port: connector has "5432", TARGET_DATABASE_URL says "5433"/);
      expect(out).toMatch(/database: connector has "d", TARGET_DATABASE_URL says "openldr_target"/);
    });

    it('reports a password change WITHOUT printing either password', async () => {
      const { app } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://u:oldpw@h:5433/d' });
      await seedEssentials(app);
      app.cfg.TARGET_DATABASE_URL = 'postgres://u:newpw@h:5433/d';
      await seedEssentials(app);
      const out = warned();
      expect(out).toMatch(/password: differs \(value withheld\)/);
      expect(out).not.toMatch(/oldpw|newpw/);
    });

    it('warns but does not throw when the config cannot be decrypted', async () => {
      const { app } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://u:p@h:5433/d' });
      await seedEssentials(app);
      app.connectors.getDecryptedConfig = async () => {
        throw new Error('SECRETS_ENCRYPTION_KEY is required');
      };
      await expect(seedEssentials(app)).resolves.toBeTruthy();
      expect(warned()).toMatch(/could not read .* to compare it against TARGET_DATABASE_URL/);
    });
  });
});

describe('seedDatabase — default connector', () => {
  const cfg = { SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://openldr:pw@warehouse:5433/openldr_target' };

  it('creates a postgres/database connector parsed from TARGET_DATABASE_URL', async () => {
    const { app, connectors } = fakeApp(cfg);
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(1);
    expect(connectors).toHaveLength(1);
    const c = connectors[0];
    expect(c.name).toBe('Target Warehouse (Postgres)');
    expect(c.type).toBe('postgres');
    expect(c.config).toEqual({ host: 'warehouse', port: '5433', user: 'openldr', password: 'pw', database: 'openldr_target', ssl: 'false' });
  });

  it('is idempotent by name — re-running does not duplicate it', async () => {
    const { app, connectors } = fakeApp(cfg);
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(1);
  });

  it('skips (and does not throw) when SECRETS_ENCRYPTION_KEY is unset', async () => {
    const { app, connectors } = fakeApp({ TARGET_DATABASE_URL: cfg.TARGET_DATABASE_URL });
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(0);
  });

  it('skips when TARGET_DATABASE_URL is unset', async () => {
    const { app, connectors } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k' });
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(0);
  });

  const mssqlCfg = {
    SECRETS_ENCRYPTION_KEY: 'k'.repeat(32),
    TARGET_STORE_ADAPTER: 'mssql' as const,
    MSSQL_HOST: 'sqlserver.local',
    MSSQL_PORT: 1433,
    MSSQL_DATABASE: 'openldr_target',
    MSSQL_USER: 'sa',
    MSSQL_PASSWORD: 'p@ss',
    MSSQL_ENCRYPT: false,
    MSSQL_TRUST_SERVER_CERT: true,
  };

  it('seeds a microsoft-sql warehouse connector when TARGET_STORE_ADAPTER=mssql', async () => {
    const { app, connectors } = fakeApp(mssqlCfg);
    const n = await seedDefaultConnector(app);
    expect(n).toBe(1);
    expect(connectors).toHaveLength(1);
    const c = connectors[0];
    expect(c.name).toBe('Target Warehouse (SQL Server)');
    expect(c.type).toBe('microsoft-sql');
    expect(c.config).toEqual({
      host: 'sqlserver.local',
      port: '1433',
      database: 'openldr_target',
      user: 'sa',
      password: 'p@ss',
      encrypt: 'false',
      trustServerCertificate: 'true',
    });
  });

  it('is idempotent by name — re-running does not duplicate the mssql connector', async () => {
    const { app, connectors } = fakeApp(mssqlCfg);
    await seedDefaultConnector(app);
    const n2 = await seedDefaultConnector(app);
    expect(n2).toBe(0);
    expect(connectors.filter((c) => c.name === 'Target Warehouse (SQL Server)')).toHaveLength(1);
  });

  it('skips the mssql connector when required MSSQL_* vars are missing', async () => {
    const { app, connectors } = fakeApp({
      SECRETS_ENCRYPTION_KEY: 'k'.repeat(32),
      TARGET_STORE_ADAPTER: 'mssql',
      MSSQL_HOST: 'sqlserver.local',
      // MSSQL_DATABASE / MSSQL_USER / MSSQL_PASSWORD intentionally absent
    });
    const n = await seedDefaultConnector(app);
    expect(n).toBe(0);
    expect(connectors).toHaveLength(0);
  });

  const mysqlCfg = {
    TARGET_STORE_ADAPTER: 'mysql' as const,
    SECRETS_ENCRYPTION_KEY: 'k',
    MYSQL_HOST: 'h',
    MYSQL_PORT: 3306,
    MYSQL_DATABASE: 'openldr_target',
    MYSQL_USER: 'u',
    MYSQL_PASSWORD: 'p',
    MYSQL_SSL: false,
    MYSQL_SSL_REJECT_UNAUTHORIZED: false,
  };

  it('seeds a mysql warehouse connector when TARGET_STORE_ADAPTER=mysql', async () => {
    const { app, connectors } = fakeApp(mysqlCfg);
    const n = await seedDefaultConnector(app);
    expect(n).toBe(1);
    expect(connectors).toHaveLength(1);
    const c = connectors[0];
    expect(c.type).toBe('mysql');
    expect(c.name).toBe('Target Warehouse (MySQL/MariaDB)');
    expect(c.config.host).toBe('h');
    expect(c.config.port).toBe('3306'); // config values are strings
    expect(c.config.sslRejectUnauthorized).toBe('false');
  });

  it('is idempotent by name — re-running does not duplicate the mysql connector', async () => {
    const { app, connectors } = fakeApp(mysqlCfg);
    await seedDefaultConnector(app);
    const n2 = await seedDefaultConnector(app);
    expect(n2).toBe(0);
    expect(connectors.filter((c) => c.name === 'Target Warehouse (MySQL/MariaDB)')).toHaveLength(1);
  });

  it('skips the mysql connector when required MYSQL_* vars are missing', async () => {
    const { app, connectors } = fakeApp({
      SECRETS_ENCRYPTION_KEY: 'k'.repeat(32),
      TARGET_STORE_ADAPTER: 'mysql',
      MYSQL_HOST: 'h',
      // MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD intentionally absent
    });
    const n = await seedDefaultConnector(app);
    expect(n).toBe(0);
    expect(connectors).toHaveLength(0);
  });
});

describe('seedDatabase — sample dashboard', () => {
  it('seeds the vetted sample dashboard (id "default") once', async () => {
    const { app, dashboards } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.dashboardsSeeded).toBe(1);
    expect(dashboards.map((d) => d.id)).toEqual(['default']);
  });

  it('is idempotent — re-running does not duplicate it', async () => {
    const { app, dashboards } = fakeApp();
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.dashboardsSeeded).toBe(0);
    expect(dashboards).toHaveLength(1);
  });
});

describe('seedDatabase — feature-flag defaults', () => {
  it('seeds every registry flag once and is idempotent on reseed', async () => {
    const { app } = fakeApp();
    // First run against an empty appSettings fake writes one row per registry flag.
    const first = await seedDatabase(fakeDb, app);
    expect(first.settingsSeeded).toBe(FEATURE_FLAGS.length);
    // Reusing the SAME fake app (persisted settings Map) — the second run finds every
    // flag already present and re-writes nothing, so an operator's later toggle survives.
    const second = await seedDatabase(fakeDb, app);
    expect(second.settingsSeeded).toBe(0);
  });
});

describe('seedDatabase — bundled terminology', () => {
  it('imports the bundled FHIR R4 catalog and full UCUM code system on first boot', async () => {
    const { app, valueSets, concepts } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    // Hundreds of FHIR R4 value sets + hundreds of UCUM concepts from the real bundled fixtures.
    expect(res.terminology.valueSetsImported).toBeGreaterThan(100);
    expect(res.terminology.ucumConceptsImported).toBeGreaterThan(100);
    // +1: the AST interpretation set is CE's OWN semantics, seeded alongside the bundled catalog
    // rather than counted by `valueSetsImported` (which reports catalog imports only).
    expect(valueSets.length).toBe(res.terminology.valueSetsImported + 1);
    expect(valueSets.some((v) => v.url === 'urn:openldr:valueset:ast-interpretation')).toBe(true);
    // meter is our UCUM presence marker — must be imported.
    expect(concepts.has('http://unitsofmeasure.org\tm')).toBe(true);
  });

  it('is idempotent — re-running imports nothing and does not throw', async () => {
    const { app, valueSets, concepts } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    const vsCount = valueSets.length;
    const conceptCount = concepts.size;
    const second = await seedDatabase(fakeDb, app);
    expect(second.terminology.valueSetsImported).toBe(0);
    expect(second.terminology.ucumConceptsImported).toBe(0);
    // No duplicates: totals unchanged after the second run.
    expect(valueSets.length).toBe(vsCount);
    expect(concepts.size).toBe(conceptCount);
    expect(first.terminology.valueSetsImported).toBeGreaterThan(0);
  });

  it('degrades gracefully when a fixture is missing (import throws → warning, seed continues)', async () => {
    const { app } = fakeApp();
    // Simulate a missing/broken fixture by making both importers throw.
    app.terminology.admin.valueSets.importFhirCatalog = async () => { throw new Error('fixture missing'); };
    app.terminology.loaders.resource = async () => { throw new Error('fixture missing'); };
    app.terminology.ops.lookup = async () => ({ found: false });
    app.terminology.admin.valueSets.list = async () => [] as never;
    const res = await seedDatabase(fakeDb, app);
    // The rest of the seed still succeeds; terminology counts fall back to 0.
    expect(res.terminology).toEqual({ valueSetsImported: 0, ucumConceptsImported: 0 });
    expect(res.workflowsSeeded).toBe(2);
    expect(res.dashboardsSeeded).toBe(1);
  });
});

describe('seedDatabase — report designs', () => {
  it('seeds no default report designs (SEED_DESIGNS is empty as of Slice S5)', async () => {
    const { app, reportDesigns } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    expect(first.reportDesignsSeeded).toBe(0);
    expect(reportDesigns).toHaveLength(0);
    const second = await seedDatabase(fakeDb, app);
    expect(second.reportDesignsSeeded).toBe(0);
  });
});

describe('seedDatabase — retired demo design cleanup (Slice S5)', () => {
  it('removes leftover demo designs from a pre-S5 install when unreferenced', async () => {
    const { app, reportDesigns } = fakeApp();
    for (const id of ['rt-amr-summary', 'rt-monthly-caseload', 'rt-lab-tat']) reportDesigns.push({ id });

    const res = await seedDatabase(fakeDb, app);
    expect(res.demoDesignsRemoved).toBe(3);
    expect(reportDesigns).toHaveLength(0);
  });

  it('skips a demo design still referenced by a reports record', async () => {
    const { app, reportDesigns, reportDefs } = fakeApp();
    for (const id of ['rt-amr-summary', 'rt-monthly-caseload', 'rt-lab-tat']) reportDesigns.push({ id });
    reportDefs.push({ id: 'r-custom', designId: 'rt-amr-summary' });

    const res = await seedDatabase(fakeDb, app);
    expect(res.demoDesignsRemoved).toBe(2);
    expect(reportDesigns.map((r) => r.id)).toEqual(['rt-amr-summary']);
  });

  it('is a no-op on a fresh install and idempotent on reseed', async () => {
    const { app } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    expect(first.demoDesignsRemoved).toBe(0);
    const second = await seedDatabase(fakeDb, app);
    expect(second.demoDesignsRemoved).toBe(0);
  });
});

describe('seedDatabase — data-driven reports (S4)', () => {
  it('skips (best-effort, no throw) when no default connector is configured', async () => {
    // fakeApp() with no cfg → seedDefaultConnector skips (SECRETS_ENCRYPTION_KEY/TARGET_DATABASE_URL
    // unset) → seedDataDrivenReports finds no connector named DEFAULT_CONNECTOR_NAME and skips too,
    // even though SEED_QUERIES/SEED_DESIGNS/SEED_REPORT_DEFS are populated as of Task 4.2.
    const { app, reportDefs } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.dataDrivenReportsSeeded).toEqual({ queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, designsUpdated: 0, reportDefsSeeded: 0, reportDefsUpdated: 0 });
    expect(reportDefs).toHaveLength(0);
  });

  it('degrades gracefully when the connector IS seeded (real SEED_QUERIES content exercised, no crash)', async () => {
    // With a connector configured, seedDataDrivenReports proceeds past the connector-resolution
    // guard and touches SEED_QUERIES/SEED_DESIGNS/SEED_REPORT_DEFS — this fake harness has no real
    // Kysely `db.internalDb` (see `fakeDb` above), so `createCustomQueryStore(db.internalDb)`'s
    // store throws once queried; the surrounding try/catch in seed.ts (best-effort, matching every
    // other seed step) swallows it and the rest of the seed still completes.
    const cfg = { SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://openldr:pw@warehouse:5433/openldr_target' };
    const { app } = fakeApp(cfg);
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(1);
    expect(res.dataDrivenReportsSeeded).toEqual({ queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, designsUpdated: 0, reportDefsSeeded: 0, reportDefsUpdated: 0 });
    expect(res.formsSeeded).toBeGreaterThan(0);
  });
});

describe('seedDatabase — default report categories', () => {
  it('seeds the 4 default categories once when the setting is unset', async () => {
    const { app, settings } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.reportCategoriesSeeded).toBe(4);
    const stored = JSON.parse(settings.get('report.categories')!);
    expect(stored).toEqual([
      { id: 'amr', label: 'AMR / Surveillance', order: 0 },
      { id: 'operational', label: 'Operational', order: 1 },
      { id: 'quality', label: 'Quality', order: 2 },
      { id: 'regulatory', label: 'Regulatory', order: 3 },
    ]);
  });

  it('is idempotent — re-running does not overwrite an operator-edited list', async () => {
    const { app, settings } = fakeApp();
    await seedDatabase(fakeDb, app);
    // Simulate an operator edit between runs.
    settings.set('report.categories', JSON.stringify([{ id: 'custom', label: 'Custom', order: 0 }]));
    const second = await seedDatabase(fakeDb, app);
    expect(second.reportCategoriesSeeded).toBe(0);
    expect(JSON.parse(settings.get('report.categories')!)).toEqual([{ id: 'custom', label: 'Custom', order: 0 }]);
  });
});

describe('fhirValueSetCatalogToInputs — bundled R4 fixture parses', () => {
  it('parses the bundled R4 catalog into value sets', async () => {
    const { BUNDLED_TERMINOLOGY, readBundledTerminology, fhirValueSetCatalogToInputs } = await import('@openldr/db');
    const catalog = await readBundledTerminology(BUNDLED_TERMINOLOGY.fhirR4Catalog);
    expect(catalog).not.toBeNull();
    const parsed = fhirValueSetCatalogToInputs(catalog);
    expect(parsed.version).toBe('R4');
    expect(parsed.valueSets.length).toBeGreaterThan(100);
    expect(parsed.valueSets.every((v) => typeof v.url === 'string' && v.url.length > 0)).toBe(true);
  });
});
