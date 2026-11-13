import type { Kysely } from 'kysely';
import type { Config } from '@openldr/config';
import type { ExternalSchema, TargetEngine } from '@openldr/db';
import { createDbContext } from './db-context';
import { seedDatabase, type FormSeedTarget } from './seed';

// Sample data from Studio. The same seed `openldr db seed` runs, but only into an install that
// holds no lab data. This file must not import from './index': index.ts re-exports it, and
// depcruise counts a type-only import as a cycle. index.ts builds the deps (sampleDataDeps).

/** FHIR resource types that mean the install holds lab data. seedEssentials, which runs on every
 *  boot, writes none of them, so a fresh install holds none. seedDatabase writes an Organization,
 *  a Location and a Patient, so a second load is refused. A QuestionnaireResponse is a saved form
 *  response, which is a lab record too. */
export const LAB_DATA_RESOURCE_TYPES = [
  'Patient', 'ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport', 'Organization', 'Location',
  'QuestionnaireResponse',
] as const;

/** Warehouse tables that mean the install holds lab data. They fill when the projector runs. */
const LAB_DATA_TABLES = ['patients', 'lab_requests'] as const;

/** The few things sample data touches. Built from the app context in index.ts. */
export interface SampleDataDeps {
  cfg: Config;
  targetEngine: TargetEngine;
  /** The warehouse (the target store's db). */
  targetDb: Kysely<ExternalSchema>;
  /** The FHIR store's listByType. */
  listByType(resourceType: string, limit: number): Promise<unknown[]>;
  /** What seedDatabase writes forms, workflows, connectors and dashboards through. */
  seedTarget: FormSeedTarget;
}

export interface SampleDataCounts {
  formsSeeded: number;
  workflowsSeeded: number;
  connectorsSeeded: number;
  dashboardsSeeded: number;
  settingsSeeded: number;
}

async function tableHasRow(deps: SampleDataDeps, table: (typeof LAB_DATA_TABLES)[number]): Promise<boolean> {
  // SQL Server has no LIMIT. Kysely compiles .limit() as written, so it needs TOP there.
  const base = deps.targetDb.selectFrom(table).select('id');
  const row = await (deps.targetEngine === 'mssql' ? base.top(1) : base.limit(1)).executeTakeFirst();
  return row !== undefined;
}

/** True when the install holds lab data. Sample data is refused then. */
export async function installHoldsLabData(deps: SampleDataDeps): Promise<boolean> {
  for (const type of LAB_DATA_RESOURCE_TYPES) {
    if ((await deps.listByType(type, 1)).length > 0) return true;
  }
  for (const table of LAB_DATA_TABLES) {
    if (await tableHasRow(deps, table)) return true;
  }
  return false;
}

/** Loads what `openldr db seed` loads, by calling the same seedDatabase. */
export async function loadSampleData(deps: SampleDataDeps): Promise<SampleDataCounts> {
  const dbCtx = await createDbContext(deps.cfg);
  try {
    const r = await seedDatabase(dbCtx, deps.seedTarget);
    return {
      formsSeeded: r.formsSeeded,
      workflowsSeeded: r.workflowsSeeded,
      connectorsSeeded: r.connectorsSeeded,
      dashboardsSeeded: r.dashboardsSeeded,
      settingsSeeded: r.settingsSeeded,
    };
  } finally {
    await dbCtx.close();
  }
}
