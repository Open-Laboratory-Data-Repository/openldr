import { Kysely } from 'kysely';
import type { Config } from '@openldr/config';
import { redact, createLogger, type Logger } from '@openldr/core';
import { createInternalDb, createFhirStore, createTerminologyStore, createTerminologyAdminStore, createOntologyStore, referenceCapture, markTerminologyChanged, createTerminologyIngestJobStore, type TerminologyAdminStore, type InternalSchema, type OntologyStore, type TerminologyIngestJobStore, resolveSeedPublisherId, deriveSystemCode } from '@openldr/db';
import { buildOntologyDistribution, canonicalSystemUrl, createOperations, type Operations, type LoaderStore, loadLoinc, loadWhonetAmr, importTerminologyResource, importOrganismDictionary, importResultParameters, stalenessReason, type LoadResult, type OrganismImportResult, type ResultParamImportResult, type OntologyBuildProgress, type OntologyManifest, type OntologyType } from '@openldr/terminology';
import { createAuditStore, type AuditStore } from '@openldr/audit';
import type { BlobStoragePort } from '@openldr/ports';
import { createBlobFromConfig } from './s3-config';
import { reexpandValueSetsForSystem } from './reexpand-value-sets';

function createOntologyApi(ontologyStore: OntologyStore) {
  return {
    listDistributions: () => ontologyStore.list(),
    async getDistribution(systemId: string) {
      const distribution = await ontologyStore.get(systemId);
      return distribution ? { ...distribution, stale: stalenessReason(distribution.manifest as OntologyManifest | null) !== null } : null;
    },
    build: (systemId: string, sourcePath: string, onProgress: (progress: OntologyBuildProgress) => void) =>
      buildOntologyDistribution(systemId, sourcePath, ontologyStore, onProgress),
    async rebuild(systemId: string, onProgress: (progress: OntologyBuildProgress) => void) {
      const distribution = await ontologyStore.get(systemId);
      if (!distribution) throw new Error('No distribution linked.');
      return buildOntologyDistribution(systemId, distribution.sourcePath, ontologyStore, onProgress);
    },
    unlink: (systemId: string) => ontologyStore.unlink(systemId),
    roots: (systemId: string) => ontologyStore.roots(systemId),
    children: (systemId: string, parent: string) => ontologyStore.children(systemId, parent),
    node: (systemId: string, code: string) => ontologyStore.node(systemId, code),
    search: (systemId: string, query: string) => ontologyStore.search(systemId, query),
    path: (systemId: string, code: string) => ontologyStore.path(systemId, code),
    panelMembers: (systemId: string, panel: string) => ontologyStore.panelMembers(systemId, panel),
    answerOptions: (systemId: string, loinc: string) => ontologyStore.answerOptions(systemId, loinc),
    specimenCodes: (systemId: string, loinc: string) => ontologyStore.specimenCodes(systemId, loinc),
  };
}

export interface TerminologyContext {
  ops: Operations;
  admin: TerminologyAdminStore;
  ontology: ReturnType<typeof createOntologyApi>;
  loaders: {
    loinc(dir: string, acceptLicense: boolean): Promise<LoadResult>;
    amr(sqlitePath: string): Promise<LoadResult[]>;
    organisms(json: unknown): Promise<OrganismImportResult>;
    parameters(json: unknown): Promise<ResultParamImportResult>;
    resource(json: unknown): Promise<LoadResult>;
  };
  ingestOntologyWithConcepts(systemType: string, systemId: string, dir: string, onProgress: (p: { phase: string; processed: number; total: number | null }) => void): Promise<{ conceptsLoaded: number }>;
  audit: AuditStore;
  logger: Logger;
  jobs: TerminologyIngestJobStore;
  blob: BlobStoragePort;
  close(): Promise<void>;
}

export async function createTerminologyContext(cfg: Config): Promise<TerminologyContext> {
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const db = internal.db as unknown as Kysely<InternalSchema>;
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const audit = createAuditStore(db);
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection = {
    async saveValueSetResource(resource: Record<string, unknown>): Promise<string> {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void> {
      await store.saveSystem(url, version, kind, resourceId);
    },
    async deleteValueSetResource(url: string, id: string): Promise<void> {
      // Delete the canonical FHIR resource FIRST: fhirStore.delete() writes an op:'delete'
      // change_log row, which is what makes the projection cycle actually clear this value
      // set's terminology_codes rows (applyProjection -> relationalWriter.deleteById on a
      // getWithProvenance miss). Deleting only terminology_systems (as this used to) left the
      // canonical fhir.fhir_resources row — and therefore the projected codes — orphaned
      // forever, and a later reprojectAll would resurrect them.
      // NOTE: keep this in lockstep with the twin implementation in packages/bootstrap/src/index.ts —
      // a previous slice in this repo was bitten by exactly these two drifting apart.
      await fhirStore.delete('ValueSet', id);
      await db.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  // Sync S3: pass referenceCapture so central terminology-metadata authoring via the CLI
  // (publishers / coding_systems / term_mappings) also lands rows in reference_change_log.
  // Inert on a lab (labs serve no pull); consistent with S2's capture-on-every-instance decision.
  const admin = createTerminologyAdminStore(db, projection, referenceCapture);
  const ontologyStore = createOntologyStore(db);
  const ontology = createOntologyApi(ontologyStore);
  const jobs = createTerminologyIngestJobStore(db);
  const blob = createBlobFromConfig(cfg);
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => store.upsertConcepts(r),
    upsertMapElements: (r) => store.upsertMapElements(r),
    // Sync S3: loaders call this once at import completion; wire it to the bulk change signal.
    markSystemChanged: (url) => markTerminologyChanged(db, url),
    saveResource: (res) => fhirStore.save(res as never),
    saveSystem: async (url, version, kind, id) => {
      await store.saveSystem(url, version, kind, id);
      // Best-effort: project CodeSystems into coding_systems so they appear in the
      // admin UI under their resolved publisher. Never fail the import on this.
      if (kind === 'CodeSystem') {
        try {
          await admin.codingSystems.upsertByUrl({
            url,
            systemCode: deriveSystemCode(url),
            systemName: deriveSystemCode(url),
            systemVersion: version,
            publisherId: resolveSeedPublisherId(url),
          });
        } catch (e) {
          // Best-effort projection: the migration backfill also covers it on next
          // migrate. Log (redacted — the error may carry the DB connection string)
          // rather than swallow, so a real failure is observable.
          console.warn('[terminology] coding_systems projection failed:', redact(e instanceof Error ? e.message : String(e)));
        }
      }
    },
  };
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: (u) => store.getResourceByUrl(u),
    translate: (q) => store.translate(q),
  });
  return {
    ops,
    admin,
    ontology,
    loaders: {
      loinc: (dir, acceptLicense) => loadLoinc(dir, { acceptLicense }, loaderStore),
      amr: (p) => loadWhonetAmr(p, loaderStore),
      resource: (json) => importTerminologyResource(json, loaderStore),
      organisms: (json) => importOrganismDictionary(json, loaderStore),
      // Task 4 (S2b): the intensional result-role ValueSets (Task 3's migration 069) are seeded with
      // no expansion — their concepts arrive here, not at migration time. Re-expand + reproject them
      // (via valueSets.save(), not expand() — see reexpand-value-sets.ts) every time this import runs,
      // or they stay empty forever and nothing reaches terminology_codes.
      parameters: async (json) => {
        const result = await importResultParameters(json, loaderStore);
        await reexpandValueSetsForSystem(admin, result.system);
        return result;
      },
    },
    async ingestOntologyWithConcepts(systemType, systemId, dir, onProgress) {
      const url = canonicalSystemUrl(systemType);
      if (!url) throw new Error(`unsupported system type: ${systemType}`);
      let conceptsLoaded = 0;
      const conceptSink = async (rows: Parameters<LoaderStore['upsertConcepts']>[0]) => {
        await loaderStore.upsertConcepts(rows);
        conceptsLoaded += rows.length;
      };
      await buildOntologyDistribution(
        systemId, dir, ontologyStore,
        (p) => onProgress({ phase: p.phase, processed: p.processed, total: p.total }),
        { conceptSink, expectedType: systemType as OntologyType },
      );
      // Registration tail — same as loadLoinc: make the terms queryable + fire the sync signal.
      const ref = await loaderStore.saveResource({ resourceType: 'CodeSystem', url, name: deriveSystemCode(url), status: 'active', content: 'not-present' });
      await loaderStore.saveSystem(url, null, 'CodeSystem', ref.id);
      await loaderStore.markSystemChanged(url);
      return { conceptsLoaded };
    },
    audit,
    logger,
    jobs,
    blob,
    async close() { await internal.close(); },
  };
}
