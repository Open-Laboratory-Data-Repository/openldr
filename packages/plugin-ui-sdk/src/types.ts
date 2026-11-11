/** The init context the host mints and transfers to the plugin iframe. */
export interface PluginInitContext {
  pluginId: string;
  capabilities: string[];
  theme: 'light' | 'dark';
  locale: string;
  sessionId: string;
}

/** Operations the plugin may request (mirror of the host broker's BrokerOp). */
export type PluginBrokerOp =
  | { kind: 'storage.get'; collection: string; key: string }
  | { kind: 'storage.put'; collection: string; key: string; doc: unknown }
  | { kind: 'storage.delete'; collection: string; key: string }
  | { kind: 'storage.list'; collection: string; where?: { field: string; eq: unknown }; limit?: number }
  | { kind: 'invoke'; entrypoint: string; input: unknown }
  | { kind: 'reports.list' }
  | { kind: 'reports.columns'; id: string }
  | { kind: 'reports.run'; id: string; params?: Record<string, unknown> }
  | { kind: 'reports.eventSources' }
  | { kind: 'connectors.list' }
  | { kind: 'connectors.test'; id: string }
  | { kind: 'connectors.metadata'; id: string }
  | { kind: 'connectors.push'; connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }
  | { kind: 'connectors.validate'; connectorId: string; mapping: unknown }
  | { kind: 'fhir.facilities' }
  | { kind: 'schedule.register'; schedule: unknown }
  | { kind: 'schedule.list' }
  | { kind: 'schedule.remove'; id: string }
  | { kind: 'import.allowed' }
  | { kind: 'import.diagnose'; connectorId: string }
  | { kind: 'import.checks'; connectorId: string; options: Record<string, string> }
  | { kind: 'import.start'; connectorId: string; options: Record<string, string>; pageSize?: number; limit?: number; dryRun?: boolean }
  | { kind: 'import.status'; runId: string }
  | { kind: 'import.list' }
  | { kind: 'import.failures'; runId: string }
  | { kind: 'import.stop'; runId: string }
  | { kind: 'import.resume'; runId: string };

export type PluginRpcResult = { ok: true; data: unknown } | { ok: false; error: string };

/** The `window.openldr` surface available to plugin code inside the iframe. */
export interface OpenLdrPluginApi {
  readonly pluginId: string;
  readonly capabilities: readonly string[];
  readonly theme: 'light' | 'dark';
  readonly locale: string;
  readonly ready: Promise<void>;
  storage: {
    get(collection: string, key: string): Promise<unknown>;
    put(collection: string, key: string, doc: unknown): Promise<void>;
    delete(collection: string, key: string): Promise<void>;
    list(collection: string, opts?: { where?: { field: string; eq: unknown }; limit?: number }): Promise<Array<{ collection: string; key: string; doc: unknown }>>;
  };
  invoke(entrypoint: string, input: unknown): Promise<unknown>;
  reports: {
    list(): Promise<unknown>;
    columns(id: string): Promise<unknown>;
    run(id: string, params?: Record<string, unknown>): Promise<unknown>;
    eventSources(): Promise<unknown>;
  };
  connectors: {
    list(): Promise<unknown>;
    test(id: string): Promise<unknown>;
    metadata(id: string): Promise<unknown>;
    push(input: { connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }): Promise<unknown>;
    validate(input: { connectorId: string; mapping: unknown }): Promise<unknown>;
  };
  fhir: { facilities(): Promise<unknown> };
  schedule: {
    register(schedule: unknown): Promise<unknown>;
    list(): Promise<unknown>;
    remove(id: string): Promise<unknown>;
  };
  /** Imports from a database connector an admin allowed for this plugin (needs host:import).
   *  The page passes a connector and options only; the plugin's wasm supplies the SQL. */
  imports: {
    allowed(): Promise<unknown>;
    diagnose(connectorId: string): Promise<unknown>;
    checks(input: { connectorId: string; options: Record<string, string> }): Promise<unknown>;
    start(input: { connectorId: string; options: Record<string, string>; pageSize?: number; limit?: number; dryRun?: boolean }): Promise<unknown>;
    status(runId: string): Promise<unknown>;
    list(): Promise<unknown>;
    failures(runId: string): Promise<unknown>;
    stop(runId: string): Promise<unknown>;
    resume(runId: string): Promise<unknown>;
  };
}

declare global {
  interface Window { openldr?: OpenLdrPluginApi }
}
