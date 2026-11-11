// apps/studio/src/query/store.ts
import { create } from 'zustand';
import type { CustomQueryParam } from './custom-query-types';

let seq = 0;
const nextId = () => `t${++seq}`;

export interface TableTab {
  id: string; kind: 'table'; connectorId: string; type: string; schema: string; table: string; title: string;
  /** Set only for a table under a SQL Server connector with a blank database. */
  database?: string;
  // Inline ad-hoc SQL for this table view: `sql` is the query the grid runs (defaults to a plain
  // browse SELECT); `showSql` toggles the inline editor's visibility.
  sql: string; showSql: boolean;
}
export interface DatasetTab { id: string; kind: 'dataset'; name: string; title: string }
export interface QueryTab {
  id: string; kind: 'query'; title: string;
  customQueryId?: string; connectorId?: string; sql: string; params: CustomQueryParam[]; dirty: boolean;
}
export type Tab = TableTab | DatasetTab | QueryTab;

/** The default browse query for a table, quoted for the connector's dialect: `[schema].[table]` for
 *  SQL Server, backticks for MySQL/MariaDB, ANSI double quotes otherwise. A SQL Server table picked
 *  under a database gets the full `[database].[schema].[table]` name. */
export function browseSql(t: { type: string; database?: string; schema: string; table: string }): string {
  if (t.type === 'microsoft-sql') {
    const db = t.database === undefined ? '' : `[${t.database.replace(/]/g, ']]')}].`;
    return `select * from ${db}[${t.schema}].[${t.table}]`;
  }
  if (t.type === 'mysql') return `select * from \`${t.schema}\`.\`${t.table}\``;
  return `select * from "${t.schema}"."${t.table}"`;
}

interface State {
  tabs: Tab[];
  activeId: string | null;
  savedRevision: number;
  refreshSavedQueries(): void;
  /** Counts Refresh clicks in the explorer menu. The explorer reloads every open branch on a change. */
  explorerRevision: number;
  refreshExplorer(): void;
  openTableTab(t: { connectorId: string; type: string; database?: string; schema: string; table: string }): void;
  openDatasetTab(d: { name: string }): void;
  openQueryTab(q: { title?: string; customQueryId?: string; connectorId?: string; sql?: string; params?: CustomQueryParam[] }): void;
  setActive(id: string): void;
  closeTab(id: string): void;
  patchQuery(id: string, patch: Partial<QueryTab>): void;
  patchTable(id: string, patch: Partial<TableTab>): void;
  /** Clear all open tabs — used to reset the workspace to a blank state when leaving the page. */
  reset(): void;
}

export const useQueryStore = create<State>((set, get) => ({
  tabs: [], activeId: null, savedRevision: 0, explorerRevision: 0,
  refreshSavedQueries() { set((state) => ({ savedRevision: state.savedRevision + 1 })); },
  refreshExplorer() { set((state) => ({ savedRevision: state.savedRevision + 1, explorerRevision: state.explorerRevision + 1 })); },
  openTableTab({ connectorId, type, database, schema, table }) {
    const existing = get().tabs.find((t) => t.kind === 'table' && t.connectorId === connectorId
      && t.database === database && t.schema === schema && t.table === table);
    if (existing) { set({ activeId: existing.id }); return; }
    const tab: TableTab = { id: nextId(), kind: 'table', connectorId, type, schema, table, title: table,
      ...(database === undefined ? {} : { database }), sql: browseSql({ type, database, schema, table }), showSql: false };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  openDatasetTab({ name }) {
    const existing = get().tabs.find((t) => t.kind === 'dataset' && t.name === name);
    if (existing) { set({ activeId: existing.id }); return; }
    const tab: DatasetTab = { id: nextId(), kind: 'dataset', name, title: name };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  openQueryTab(q) {
    if (q.customQueryId) {
      const existing = get().tabs.find((t) => t.kind === 'query' && t.customQueryId === q.customQueryId);
      if (existing) { set({ activeId: existing.id }); return; }
    }
    const n = get().tabs.filter((t) => t.kind === 'query').length + 1;
    const tab: QueryTab = { id: nextId(), kind: 'query', title: q.title ?? `Query #${n}`,
      customQueryId: q.customQueryId, connectorId: q.connectorId, sql: q.sql ?? '', params: q.params ?? [], dirty: false };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  setActive(id) { set({ activeId: id }); },
  closeTab(id) {
    const { tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    let active = activeId;
    if (activeId === id) active = next[idx] ? next[idx].id : next[idx - 1]?.id ?? null;
    set({ tabs: next, activeId: active });
  },
  patchQuery(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && t.kind === 'query' ? { ...t, ...patch } : t)) }));
  },
  patchTable(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && t.kind === 'table' ? { ...t, ...patch } : t)) }));
  },
  reset() { set({ tabs: [], activeId: null }); },
}));
