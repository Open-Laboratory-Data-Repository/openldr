import type { ColumnType, FilterOperator } from "./types";

export interface TableColumnSpec {
  /** Physical SQL column. May differ from the wire id. */
  sql: string;
  type: ColumnType;
  /** Exactly the operators the server will run. The UI offers no more than this. */
  operators: FilterOperator[];
  sortable: boolean;
}

export type TableColumnMap = Record<string, TableColumnSpec>;

const TEXT_OPS: FilterOperator[] = ["eq", "ne", "like", "in", "is_null", "is_not_null"];
const ENUM_OPS: FilterOperator[] = ["eq", "ne", "in", "is_null", "is_not_null"];
// Must match apps/studio/src/components/data-table/types.ts:52-53's validOperators("date") —
// that is what the UI actually offers, and this map must run no less and no more.
export const DATE_OPS: FilterOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte", "between", "is_null", "is_not_null"];

// Mirrors AuditEventsTable, packages/db/src/schema/internal.ts:147-159.
export const AUDIT_COLUMNS: TableColumnMap = {
  id:         { sql: "id",          type: "text", operators: ["eq", "in"], sortable: true },
  occurredAt: { sql: "occurred_at", type: "date", operators: DATE_OPS,     sortable: true },
  actorType:  { sql: "actor_type",  type: "enum", operators: ENUM_OPS,     sortable: true },
  actorId:    { sql: "actor_id",    type: "text", operators: TEXT_OPS,     sortable: true },
  actorName:  { sql: "actor_name",  type: "text", operators: TEXT_OPS,     sortable: true },
  action:     { sql: "action",      type: "text", operators: TEXT_OPS,     sortable: true },
  entityType: { sql: "entity_type", type: "text", operators: TEXT_OPS,     sortable: true },
  entityId:   { sql: "entity_id",   type: "text", operators: TEXT_OPS,     sortable: true },
};

// Mirrors FacilityRegistryTable, packages/db/src/schema/internal.ts:240-271.
export const FACILITY_COLUMNS: TableColumnMap = {
  id:            { sql: "id",              type: "text", operators: ["eq", "in"], sortable: true },
  name:          { sql: "name",            type: "text", operators: TEXT_OPS,     sortable: true },
  code:          { sql: "facility_code",   type: "text", operators: TEXT_OPS,     sortable: true },
  country:       { sql: "country",         type: "enum", operators: ENUM_OPS,     sortable: true },
  zone:          { sql: "zone",            type: "enum", operators: ENUM_OPS,     sortable: true },
  region:        { sql: "region",          type: "enum", operators: ENUM_OPS,     sortable: true },
  district:      { sql: "district",        type: "enum", operators: ENUM_OPS,     sortable: true },
  council:       { sql: "council",         type: "enum", operators: ENUM_OPS,     sortable: true },
  status:        { sql: "status",          type: "enum", operators: ENUM_OPS,     sortable: true },
  level:         { sql: "level",           type: "enum", operators: ENUM_OPS,     sortable: true },
  ownership:     { sql: "ownership",       type: "enum", operators: ENUM_OPS,     sortable: true },
  facilitySystem:{ sql: "facility_system", type: "text", operators: TEXT_OPS,     sortable: true },
  source:        { sql: "source",         type: "enum", operators: ENUM_OPS,     sortable: true },
  managedOrigin: { sql: "managed_origin", type: "enum", operators: ENUM_OPS,     sortable: true },
  registerState: { sql: "register_state", type: "enum", operators: ENUM_OPS,     sortable: true },
};

/** Appended to every sort so ORDER BY + OFFSET is stable across pages. */
export const AUDIT_TIEBREAKER = "id";
export const FACILITY_TIEBREAKER = "id";
