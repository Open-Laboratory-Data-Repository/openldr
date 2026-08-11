import type { Generated, JSONColumnType } from 'kysely';
import type { FhirResource } from '@openldr/fhir';

export interface FhirResourcesTable {
  resource_type: string;
  id: string;
  version: Generated<number>; // monotonic integer version (distinct from version_id, the FHIR meta.versionId string mirror)
  version_id: string | null;
  resource: JSONColumnType<FhirResource>;
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ResourceHistoryTable {
  resource_type: string;
  id: string;
  version: number;
  op: string; // 'upsert' | 'delete'
  resource: JSONColumnType<FhirResource> | null; // null for delete tombstones
  recorded_at: Generated<Date>;
}

export interface ChangeLogTable {
  seq: Generated<number>;
  resource_type: string;
  resource_id: string;
  version: number;
  op: string; // 'upsert' | 'delete'
  content_hash: string | null;
  site_id: string | null;
  recorded_at: Generated<Date>;
}

export interface ChangeCursorsTable {
  consumer: string;
  last_seq: Generated<number>;
  updated_at: Generated<Date>;
}

// Distributed sync S2: append-only reference-data change-capture log (public schema).
// Mirrors ChangeLogTable's cursor shape for config entities (form/dashboard/report/setting).
export interface ReferenceChangeLogTable {
  seq: Generated<number>;
  entity_type: string;
  entity_id: string;
  op: string; // 'upsert' | 'delete'
  content_hash: string | null;
  recorded_at: Generated<Date>;
}

// Distributed sync S6a: central-side amendment outbox (public schema). One row per central-authored
// resource version routed to the owning lab (site_id). Pointer only — the serve reads the live body
// from fhir.resource_history at `version`. `seq` (bigserial) is this stream's pull-cursor axis.
export interface SyncAmendmentsTable {
  seq: Generated<number>;
  site_id: string;
  resource_type: string;
  resource_id: string;
  version: number;
  recorded_at: Generated<Date>;
}

// Distributed sync S7-A: lab-side poison-bulk quarantine (public schema). One row per failing bulk entity
// (terminology system / concept map). `status` is 'holding' (below threshold, cursor still holds) or
// 'quarantined' (crossed → runner advances past). PK (entity_type, entity_id).
export interface SyncQuarantineTable {
  entity_type: string;
  entity_id: string;
  attempts: Generated<number>;
  status: string;
  last_error: string | null;
  last_seq: number | null;
  last_body: unknown | null;
  first_failed_at: Generated<Date>;
  updated_at: Generated<Date>;
  quarantined_at: Date | null;
}

// Distributed sync S7: same-version divergence record (see migration 056). Nullable hash/body columns
// mean "tombstone" — a delete-vs-edit collision at the same version is a real divergence.
export interface SyncDivergencesTable {
  resource_type: string;
  resource_id: string;
  version: number;
  local_hash: string | null;
  incoming_hash: string | null;
  incoming_body: unknown | null;
  incoming_site_id: string;
  detected_at: Generated<Date>;
}

// Distributed sync S7 (A1): each site's REPORTED consumed position per stream (migration 057).
// See the migration comment: `seq` is NEVER clamped to max — it is a safety floor, not a counter.
export interface SyncSiteCursorsTable {
  site_id: string;
  consumer: string;
  seq: number;
  reported_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: string;
  type: string;
  payload: JSONColumnType<Record<string, unknown>>;
  status: Generated<string>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  last_error: string | null;
  batch_id: string | null;
  available_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IngestBatchesTable {
  batch_id: string;
  source: string | null;
  blob_key: string;
  content_type: string | null;
  converter: string;
  status: Generated<string>;
  resource_count: Generated<number>;
  attempts: Generated<number>;
  last_error: string | null;
  config: JSONColumnType<Record<string, string>> | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PluginsTable {
  id: string;
  version: string;
  sha256: string;
  manifest: JSONColumnType<Record<string, unknown>>;
  status: Generated<string>;
  installed_at: Generated<Date>;
  enabled: Generated<boolean>;
  active: Generated<boolean>;
  approved_by: string | null;
  granted_at: Date | null;
}

export interface AuditEventsTable {
  id: string;
  occurred_at: Generated<Date>;
  actor_type: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: JSONColumnType<Record<string, unknown>> | null;
  after: JSONColumnType<Record<string, unknown>> | null;
  metadata: JSONColumnType<Record<string, unknown>> | null;
}

export interface SyncActivityTable {
  id: string;
  occurred_at: Generated<Date>;
  direction: string;
  event: string;
  records: Generated<number>;
  error: string | null;
  metadata: JSONColumnType<Record<string, unknown>> | null;
}

export interface NotificationReadsTable {
  user_id: string;
  notification_id: string;
  read_at: Generated<Date>;
}

export interface NotificationPrefsTable {
  user_id: string;
  type: string;
  enabled: boolean | null;
  value: string | null;
}

export interface UsersTable {
  id: string;
  subject: string | null;
  username: string;
  display_name: string | null;
  email: string | null;
  roles: JSONColumnType<string[]>;
  status: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  last_login_at: Date | null;
  rbac_initialized: Generated<boolean>;
}

export interface RolesTable {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_system: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
export interface RoleCapabilitiesTable {
  role_id: string;
  capability: string;
}
export interface UserRolesTable {
  user_id: string; // Keycloak subject (directory id), NOT local users.id
  role_id: string;
}

export interface DashboardsTable {
  id: string;
  owner_id: string | null;
  name: string;
  layout: JSONColumnType<unknown[]>;
  widgets: JSONColumnType<unknown[]>;
  filters: JSONColumnType<unknown[]>;
  refresh_interval_sec: Generated<number>;
  is_default: Generated<boolean>;
  managed_origin: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ColumnExposurePolicyTable {
  table_name: string;
  column_name: string;
  hidden: Generated<boolean>;
  updated_at: Generated<Date>;
  updated_by: string | null;
}

/** Curated facility record — what we KNOW. Distinct from the analytics `facilities` table, which is
 *  the uncurated projection of ingested Organization/Location resources. */
export interface FacilityRegistryTable {
  id: string;
  /** OURS. Required at data entry, absent on a nationally-imported row. */
  local_code: string | null;
  national_system: string | null;
  /** THEIRS. The only code an imported row carries. */
  national_code: string | null;
  name: string;
  level: string | null;
  ownership: string | null;
  status: string | null;
  country: string | null;
  zone: string | null;
  region: string | null;
  district: string | null;
  council: string | null;
  ward: string | null;
  village: string | null;
  address_text: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  extras: unknown;
  /** NULL = lab-local, 'central' = central-managed (migration 048 convention). */
  managed_origin: string | null;
  source: string;
  /** Registry MEMBERSHIP, distinct from `status` (operational, HL7 location-status). One of
   *  `in_register` / `dropped` / `not_registered` — see migration 081's FACILITY_REGISTER_STATE_VS. */
  register_state: Generated<string>;
  created_at: string;
  updated_at: string;
}

/** The durable answer to "what code does this `facility_registry` row currently project as?" —
 *  read/written by the mapping-migration layer (task 7), never by the projection itself. Deliberately
 *  a table, not a concept `properties` key: `terms.update` rewrites `properties` wholesale and would
 *  silently destroy this link (see migration 077). */
export interface FacilityConceptProjectionTable {
  registry_id: string;
  concept_code: string;
  updated_at: Generated<Date>;
}

/** Durable work items for the facility subsystem: rebuilding the report-facing `facility_map`
 *  (`kind: 'facility-map-rebuild'`) and retrying a concept projection that failed inline
 *  (`kind: 'registry-projection'`). See migration 079 for why `active_key` is a plain (not
 *  partial) unique index and its asymmetric queued-coalesces/running-doesn't-swallow contract. */
export interface FacilityJobsTable {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  /** Which facility a 'registry-projection' retry is for. NULL for a whole-dimension rebuild. */
  registry_id: string | null;
  /** Rows written by the last successful rebuild. NULL for a projection-kind job. */
  result_count: number | null;
  requested_by: string | null;
  requested_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  active_key: string | null;
}

/** One durable record per facility import (FAC-P1-03). Also the job row a background import is
 *  claimed from in A2b. ⛔ `active_key` holds `national_system` while a run is active and is NULL
 *  once terminal — see migration 080 for why it is a plain, not partial, unique index, and why this
 *  deliberately does NOT copy `facility_jobs`' coalesce-on-kind identity. */
export interface FacilityImportRunsTable {
  id: string;
  national_system: string;
  source_format: string;
  blob_key: string | null;
  file_hash: string;
  byte_size: number;
  release_version: string | null;
  release_published_at: Date | null;
  declared_row_count: number | null;
  declared_deletion_count: number | null;
  status: string;
  phase: string | null;
  processed: Generated<number>;
  total: number | null;
  /** ⛔ The conflict watermark. `timestamptz` — the driver returns a `Date`. Never compare as a
   *  string; see `facility-job-store.ts`, which normalises every read through `new Date(...)`. */
  previewed_at: Date | null;
  summary: unknown;
  result_blob_key: string | null;
  options: unknown;
  error: string | null;
  cancel_requested: Generated<boolean>;
  requested_by: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  active_key: string | null;
}

/** Pre-existing violations of "one active SAME-AS resolution per observed facility key", recorded by
 *  migration 078 when it closed that invariant at the database, for an operator to settle.
 *
 *  `kind: 'duplicate'` — a set of active SAME-AS mappings on one observed key naming DIFFERENT
 *  facilities. Every member was deactivated (the migration refuses to pick a winner), so the observed
 *  string now falls back to the raw performer text until someone chooses.
 *  `kind: 'unsupported_map_type'` — one mapping whose `map_type` is not `SAME-AS`. It was left exactly
 *  as it was; the resolver already refuses to resolve through it, and this row only explains why. */
export interface FacilityMappingConflictsTable {
  id: Generated<number>;
  from_system: string;
  from_code: string;
  kind: string;
  /** Every mapping id in the recorded set, oldest first. */
  mapping_ids: JSONColumnType<string[]>;
  /** Shape depends on `kind`: an array of `{ id, toCode, createdAt }` for 'duplicate', a single
   *  `{ mapType, toCode }` for 'unsupported_map_type'. */
  detail: JSONColumnType<Record<string, unknown> | unknown[]> | null;
  detected_at: Generated<Date>;
  /** Set when an operator settles the set; NULL while it still needs review. */
  resolved_at: Date | null;
}

export interface TerminologyConceptsTable {
  system: string;
  code: string;
  display: string | null;
  status: string | null;
  properties: JSONColumnType<Record<string, unknown>> | null;
}

export interface TerminologySystemsTable {
  url: string;
  version: string | null;
  kind: string;
  resource_id: string;
  // Sync S3: bump-once-per-import bulk change signal. `bigint DEFAULT 0` reads back as a string on
  // real PG (number under pg-mem); Generated<> keeps it optional on insert so saveSystem (which does
  // not set it) still typechecks. The mark* helpers set it explicitly and Number()-coerce on read.
  generation: Generated<number | string>;
  managed_origin: string | null;
}

export interface ConceptMapElementsTable {
  map_url: string;
  source_system: string;
  source_code: string;
  target_system: string;
  target_code: string;
  equivalence: string | null;
}

// Sync S3: per-concept-map generation registry (concept_map_elements has no PK/metadata row of its
// own, so the bulk change signal for maps lives here, keyed by map_url). Mirrors the terminology_systems
// generation/managed_origin columns.
export interface ConceptMapStateTable {
  map_url: string;
  generation: Generated<number | string>;
  managed_origin: string | null;
}

export interface PublishersTable {
  id: string;
  name: string;
  role: string; // 'local' | 'standard' | 'external'
  icon: string | null;
  match_prefixes: JSONColumnType<string[]>;
  seeded: Generated<boolean>;
  sort_order: Generated<number>;
  managed_origin: string | null;
}

export interface CodingSystemsTable {
  id: string;
  system_code: string;
  system_name: string;
  url: string | null;
  system_version: string | null;
  description: string | null;
  active: Generated<boolean>;
  publisher_id: string | null;
  seeded: Generated<boolean>;
  managed_origin: string | null;
  /** Marks a row as a facility register (`FACILITY_REGISTER_KIND` in migration 081) or other kind of
   *  source. A REAL COLUMN, deliberately — never a URL-prefix convention. */
  kind: string | null;
  jurisdiction: string | null;
  contact: string | null;
}

export interface TermMappingsTable {
  id: string;
  from_system: string;
  from_code: string;
  to_system: string;
  to_code: string;
  to_display: string | null;
  map_type: string;
  relationship: string | null;
  owner: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  managed_origin: string | null;
}

export interface ValueSetsTable {
  id: string;
  url: string;
  version: string | null;
  name: string | null;
  title: string | null;
  status: Generated<string>;
  experimental: Generated<boolean>;
  description: string | null;
  compose: JSONColumnType<Record<string, unknown>>;
  source_json: JSONColumnType<Record<string, unknown>> | null;
  immutable: Generated<boolean>;
  category: string | null;
  publisher_id: string | null;
  expanded_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ValuesetExpansionsTable {
  value_set_id: string;
  system_url: string;
  code: string;
  display: string | null;
  inactive: Generated<boolean>;
}

export interface OntologyDistributionsTable {
  coding_system_id: string;
  ontology_type: string;
  source_path: string;
  index_status: string;
  index_error: string | null;
  node_count: number | null;
  edge_count: number | null;
  manifest: unknown | null;
  built_at: string | null;
  updated_at: string;
}

export interface OntologyNodesTable {
  coding_system_id: string;
  code: string;
  display: string;
  kind: string | null;
  extra: unknown | null;
}

export interface OntologyEdgesTable {
  coding_system_id: string;
  parent_code: string;
  child_code: string;
  seq: number;
  label: string | null;
}

export interface OntologyPanelMembersTable {
  coding_system_id: string;
  panel_loinc: string;
  member_loinc: string;
  member_name: string;
  display_name: string;
  sequence: number;
  required: boolean;
}

export interface OntologyAnswerOptionsTable {
  coding_system_id: string;
  loinc: string;
  seq: number;
  value: string;
  label: string;
}

export interface OntologySpecimenMapTable {
  coding_system_id: string;
  loinc: string;
  snomed_code: string;
  equivalence: string;
}

export interface Dhis2OrgUnitMapTable {
  facility_id: string;
  orgunit_id: string;
  orgunit_name: string | null;
}

export interface Dhis2MappingsTable {
  id: string;
  name: string;
  definition: JSONColumnType<Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Dhis2SchedulesTable {
  id: string;
  mapping_id: string;
  mode: string;
  period_type: string;
  event_driven: Generated<boolean>;
  enabled: Generated<boolean>;
  last_run_at: Date | null;
  next_due_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Dhis2MetadataCacheTable {
  id: string;
  metadata: JSONColumnType<import('@openldr/ports').TargetMetadata>;
  pulled_at: Generated<Date>;
}

export interface FormDefinitionsTable {
  id: string;
  name: string;
  version_label: string | null;
  fhir_resource_type: string | null;
  fhir_version: string | null;
  fhir_profile_url: string | null;
  facility_id: string | null;
  status: string;
  active: boolean;
  schema: unknown;
  target_pages: unknown | null;
  managed_origin: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfilesTable {
  user_id: string;
  form_schema_id: string | null;
  form_version: number | null;
  extras: unknown;
  updated_at: Date;
}

export interface ReportRunsTable {
  id: string;
  report_id: string;
  report_name: string;
  format: string;
  params: JSONColumnType<Record<string, unknown>>;
  row_count: number | null;
  user_id: string | null;
  user_name: string | null;
  created_at: Generated<Date>;
}

export interface ReportSchedulesTable {
  id: string;
  report_id: string;
  params: JSONColumnType<Record<string, unknown>>;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  output_format: string;
  enabled: Generated<boolean>;
  last_run_at: Date | null;
  next_due_at: Date | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReportScheduleRunsTable {
  id: string;
  schedule_id: string;
  report_id: string;
  report_name: string;
  run_at: Generated<Date>;
  period_start: Date | null;
  period_end: Date | null;
  output_format: string;
  object_key: string | null;
  byte_size: number | null;
  row_count: number | null;
  status: string;
  error_message: string | null;
  created_at: Generated<Date>;
}

export interface FormVersionsTable {
  id: string;
  form_id: string;
  version: number;
  version_label: string | null;
  name: string;
  fhir_resource_type: string | null;
  fhir_version: string | null;
  fhir_profile_url: string | null;
  facility_id: string | null;
  schema: JSONColumnType<Record<string, unknown>>;
  target_pages: JSONColumnType<string[]> | null;
  questionnaire: JSONColumnType<Record<string, unknown>>;
  published_at: Generated<Date>;
  published_by: string | null;
}

export interface MarketplacePublishersTable {
  publisher_id: string;
  key_fingerprint: string;
  publisher_name: Generated<string>;
  pinned_at: Generated<Date>;
  approved_by: string | null;
}

export interface MarketplaceInstallsTable {
  artifact_id: string;
  version: string;
  kind: string;
  target_form_id: string;
  payload_sha256: string;
  publisher_name: string | null;
  source_ref: string | null;
  installed_by: string | null;
  installed_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WorkflowsTable {
  id: string;
  name: string;
  description: string | null;
  definition: JSONColumnType<{ nodes: unknown[]; edges: unknown[] }>;
  enabled: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WorkflowRunsTable {
  id: string;
  workflow_id: string;
  trigger_source: string;
  status: string;
  started_at: Date;
  finished_at: Date;
  result: JSONColumnType<Record<string, unknown>>;
  error: string | null;
  correlation_id: string | null;
}

export interface WorkflowSchedulesTable {
  workflow_id: string;
  node_id: string;
  cron: string;
  tz: string | null;
  enabled: Generated<boolean>;
  next_due_at: Date | null;
}

export interface WorkflowDatasetsTable {
  id: string;
  name: string;
  columns: JSONColumnType<{ key: string; label: string }[]>;
  rows: JSONColumnType<Record<string, unknown>[]>;
  row_count: Generated<number>;
  workflow_id: string | null;
  published_table: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CustomQueriesTable {
  id: string;
  name: string;
  connector_id: string;
  sql: string;
  params: unknown; // JSON: CustomQueryParam[]
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConnectorsTable {
  id: string;
  name: string;
  plugin_id: string | null;
  type: string | null;
  kind: string;
  config_encrypted: string;
  allowed_host: string | null;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RegistriesTable {
  id: string;
  name: string;
  kind: string; // 'local' | 'http'
  location: string;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PluginDataTable {
  plugin_id: string;
  collection: string;
  key: string;
  doc: JSONColumnType<Record<string, unknown>>;
  updated_at: Generated<Date>;
}

export interface AppSettingsTable {
  key: string;
  value: string;
  updated_at: Generated<Date>;
  updated_by: string | null;
}

/** Ledger of capability keys that have ever existed in the catalog (migration 067).
 *  Read by RoleStore.seedSystemRoles() to decide whether a preset capability is brand-new
 *  (safe to grant once) or has already had its one free grant (a later absence is a revoke). */
export interface CapabilityIntroductionsTable {
  capability: string;
  introduced_at: Generated<Date>;
}

export interface ReportDesignsTable {
  id: string;
  name: string;
  paper: Generated<string>;
  orientation: Generated<string>;
  pages: unknown;
  parameters: unknown;
  margins: unknown | null;
  page_numbers: boolean | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReportsTable {
  id: string;
  name: string;
  description: string;
  category: string;
  design_id: string;
  primary_query_id: string;
  summary_metrics: unknown | null;
  chart: unknown | null;
  param_options: unknown | null;
  status: string;
  managed_origin: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// Distributed sync S4d: central-side registry of enrolled labs (one row per site). Never stores the
// client secret — the secret is minted once and returned, never persisted. `status` is 'active'|'revoked'.
export interface SyncSitesTable {
  site_id: string;
  name: string | null;
  client_id: string;
  enrolled_at: Generated<Date>;
  enrolled_by: string | null;
  status: Generated<string>;
  // Sync S5: the site's ed25519 SPKI DER public key (hex) — central verifies the lab's push
  // bundles with it. The site's PRIVATE key is never persisted centrally.
  signing_public_key: string | null;
}

// Workflow secret store (SEC-06): encrypted at-rest store for secrets extracted from workflow
// definitions. `sealed_value` is the AES-256-GCM blob (never plaintext); rows are grouped by
// `workflow_id` for GC / cascade-delete.
export interface WorkflowSecretsTable {
  id: string;
  workflow_id: string;
  sealed_value: string;
  created_at: Generated<Date>;
}

// Terminology distribution ingest jobs: background jobs that stream a blob upload
// (loaded via Task 1's streaming blob methods) into a coding system's concepts.
// At most one active (queued|running) job per system_type is enforced by a unique
// index on `active_key` in the migration, plus a store-level `hasActive` guard in `enqueue`.
export interface TerminologyIngestJobsTable {
  id: string;
  system_type: string;
  coding_system_id: string;
  blob_key: string;
  version: string | null;
  status: string;
  phase: string | null;
  processed: Generated<string>; // bigint → string on read
  total: string | null;
  error: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  // Mirrors `system_type` while the job is queued|running, NULL once finished; backs the
  // "one active job per system" unique index. See the 061 migration for why.
  active_key: string | null;
}

export interface InternalSchema {
  'fhir.fhir_resources': FhirResourcesTable;
  'fhir.resource_history': ResourceHistoryTable;
  'fhir.change_log': ChangeLogTable;
  'fhir.change_cursors': ChangeCursorsTable;
  reference_change_log: ReferenceChangeLogTable;
  sync_amendments: SyncAmendmentsTable;
  sync_quarantine: SyncQuarantineTable;
  sync_divergences: SyncDivergencesTable;
  sync_site_cursors: SyncSiteCursorsTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
  plugins: PluginsTable;
  audit_events: AuditEventsTable;
  sync_activity: SyncActivityTable;
  notification_reads: NotificationReadsTable;
  notification_prefs: NotificationPrefsTable;
  users: UsersTable;
  terminology_concepts: TerminologyConceptsTable;
  terminology_systems: TerminologySystemsTable;
  concept_map_elements: ConceptMapElementsTable;
  concept_map_state: ConceptMapStateTable;
  publishers: PublishersTable;
  coding_systems: CodingSystemsTable;
  term_mappings: TermMappingsTable;
  value_sets: ValueSetsTable;
  valueset_expansions: ValuesetExpansionsTable;
  ontology_distributions: OntologyDistributionsTable;
  ontology_nodes: OntologyNodesTable;
  ontology_edges: OntologyEdgesTable;
  ontology_panel_members: OntologyPanelMembersTable;
  ontology_answer_options: OntologyAnswerOptionsTable;
  ontology_specimen_map: OntologySpecimenMapTable;
  dhis2_orgunit_map: Dhis2OrgUnitMapTable;
  dhis2_mappings: Dhis2MappingsTable;
  dhis2_schedules: Dhis2SchedulesTable;
  dhis2_metadata_cache: Dhis2MetadataCacheTable;
  dashboards: DashboardsTable;
  column_exposure_policy: ColumnExposurePolicyTable;
  facility_registry: FacilityRegistryTable;
  facility_concept_projection: FacilityConceptProjectionTable;
  facility_mapping_conflicts: FacilityMappingConflictsTable;
  facility_jobs: FacilityJobsTable;
  facility_import_runs: FacilityImportRunsTable;
  form_definitions: FormDefinitionsTable;
  form_versions: FormVersionsTable;
  user_profiles: UserProfilesTable;
  marketplace_publishers: MarketplacePublishersTable;
  marketplace_installs: MarketplaceInstallsTable;
  report_runs: ReportRunsTable;
  report_schedules: ReportSchedulesTable;
  report_schedule_runs: ReportScheduleRunsTable;
  workflows: WorkflowsTable;
  workflow_runs: WorkflowRunsTable;
  workflow_schedules: WorkflowSchedulesTable;
  workflow_datasets: WorkflowDatasetsTable;
  custom_queries: CustomQueriesTable;
  connectors: ConnectorsTable;
  registries: RegistriesTable;
  plugin_data: PluginDataTable;
  app_settings: AppSettingsTable;
  report_designs: ReportDesignsTable;
  reports: ReportsTable;
  sync_sites: SyncSitesTable;
  workflow_secrets: WorkflowSecretsTable;
  terminology_ingest_jobs: TerminologyIngestJobsTable;
  roles: RolesTable;
  role_capabilities: RoleCapabilitiesTable;
  capability_introductions: CapabilityIntroductionsTable;
  user_roles: UserRolesTable;
}
