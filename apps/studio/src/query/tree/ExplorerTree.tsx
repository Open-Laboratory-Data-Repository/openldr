// apps/studio/src/query/tree/ExplorerTree.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, Plug, Package, Zap, Table2, Folder, MoreHorizontal, Database } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { queryApi, type ConnectorRef, type DatasetRef } from '../api';
import { useQueryStore } from '../store';
import type { CustomQuery, CustomQueryGroup } from '../custom-query-types';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { QueryNameSheet } from '../workspace/QueryNameSheet';

function Row({ depth, open, onClick, icon, label, active, count }:
  { depth: number; open?: boolean; onClick(): void; icon: React.ReactNode; label: string; active?: boolean; count?: number }) {
  return (
    <button onClick={onClick}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent ${active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
      style={{ paddingLeft: 8 + depth * 14 }}>
      {open === undefined ? <span className="w-3.5 shrink-0" /> : open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      <span className="flex shrink-0 items-center">{icon}</span>
      <TruncatedText text={label} side="right" className="min-w-0" />
      {count !== undefined && <span className="ml-auto shrink-0 pl-1 text-xs tabular-nums text-muted-foreground/70">{count}</span>}
    </button>
  );
}

/** The `⋯` button on a tree row. Shown on hover or focus, and always on a phone, which has no hover. */
function RowMenu({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}
          className="mr-1 h-6 w-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- Grouping, as pure functions so they can be tested without a drag ----

export interface GroupedQueries {
  groups: { group: CustomQueryGroup; queries: CustomQuery[] }[];
  ungrouped: CustomQuery[];
}

/** Puts each query under its group. A query whose group no longer exists counts as ungrouped. */
export function groupQueries(queries: CustomQuery[], groups: CustomQueryGroup[]): GroupedQueries {
  const byGroup = new Map(groups.map((g) => [g.id, [] as CustomQuery[]]));
  const ungrouped: CustomQuery[] = [];
  for (const q of queries) {
    const bucket = q.groupId ? byGroup.get(q.groupId) : undefined;
    if (bucket) bucket.push(q); else ungrouped.push(q);
  }
  return { groups: groups.map((g) => ({ group: g, queries: byGroup.get(g.id)! })), ungrouped };
}

const QUERY_DRAG = 'query:';
const GROUP_DROP = 'group:';
const NO_GROUP = '__none__';
export const queryDragId = (id: string): string => QUERY_DRAG + id;
export const groupDropId = (groupId: string | null): string => GROUP_DROP + (groupId ?? NO_GROUP);

/** What a drop does: the query id and the group it moves to (null for no group). Null when nothing moves. */
export function dropMove(activeId: string, overId: string | null, queries: CustomQuery[]): { queryId: string; groupId: string | null } | null {
  if (!overId || !activeId.startsWith(QUERY_DRAG) || !overId.startsWith(GROUP_DROP)) return null;
  const queryId = activeId.slice(QUERY_DRAG.length);
  const raw = overId.slice(GROUP_DROP.length);
  const groupId = raw === NO_GROUP ? null : raw;
  const q = queries.find((x) => x.id === queryId);
  if (!q || (q.groupId ?? null) === groupId) return null;
  return { queryId, groupId };
}

function DropTarget({ groupId, children }: { groupId: string | null; children: React.ReactNode }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: groupDropId(groupId) });
  return (
    <div ref={setNodeRef} data-testid={`query-drop-${groupId ?? 'none'}`}
      className={`rounded ${isOver ? 'bg-primary/10 ring-1 ring-primary/60' : ''}`}>
      {children}
    </div>
  );
}

function DraggableQuery({ id, children }: { id: string; children: React.ReactNode }): JSX.Element {
  // Only the pointer listeners. The row inside is already a button, and keyboard users move a
  // query with the row's "Move to group" menu.
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: queryDragId(id) });
  return (
    <div ref={setNodeRef} {...listeners} className={`group flex min-w-0 items-center ${isDragging ? 'opacity-40' : ''}`}>
      {children}
    </div>
  );
}

type NameSheet =
  | { kind: 'newGroup' }
  | { kind: 'renameGroup'; group: CustomQueryGroup }
  | { kind: 'renameQuery'; query: CustomQuery };

// ---- Where schemas come from ----

/** A connector, or one database under a SQL Server connector whose own database is blank. */
interface Scope { id: string; database?: string }

/** Branch and cache key for a scope. A NUL byte cannot appear in a connector id or a database name. */
const scopeKey = (s: Scope): string => (s.database === undefined ? s.id : `${s.id}\u0000${s.database}`);
const scopeOf = (key: string): Scope => {
  const nul = key.indexOf('\u0000');
  return nul === -1 ? { id: key } : { id: key.slice(0, nul), database: key.slice(nul + 1) };
};
const fetchSchemas = (s: Scope): Promise<string[]> =>
  (s.database === undefined ? queryApi.schemas(s.id) : queryApi.schemas(s.id, s.database));
const fetchTables = (s: Scope, schema: string): Promise<string[]> =>
  (s.database === undefined ? queryApi.tables(s.id, schema) : queryApi.tables(s.id, schema, s.database));

export function ExplorerTree(): JSX.Element {
  const { t } = useTranslation();
  const openTableTab = useQueryStore((s) => s.openTableTab);
  const openDatasetTab = useQueryStore((s) => s.openDatasetTab);
  const openQueryTab = useQueryStore((s) => s.openQueryTab);
  const tabs = useQueryStore((s) => s.tabs);
  const closeTab = useQueryStore((s) => s.closeTab);
  const patchQuery = useQueryStore((s) => s.patchQuery);
  const savedRevision = useQueryStore((s) => s.savedRevision);

  const [openBranch, setOpenBranch] = useState<Record<string, boolean>>({});
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [datasets, setDatasets] = useState<DatasetRef[]>([]);
  const [queries, setQueries] = useState<CustomQuery[]>([]);
  const [groups, setGroups] = useState<CustomQueryGroup[]>([]);
  // Per connector: its databases, or null when the tree goes straight to schemas.
  const [databases, setDatabases] = useState<Record<string, string[] | null>>({});
  // Keyed by scopeKey, and tables by `${scopeKey}/${schema}`.
  const [schemas, setSchemas] = useState<Record<string, string[]>>({});
  const [tables, setTables] = useState<Record<string, string[]>>({});

  const toggle = (k: string) => setOpenBranch((o) => ({ ...o, [k]: !o[k] }));

  // Explorer loads are best-effort; surface a failed fetch to the console rather than
  // leaving it as a silent unhandled rejection (the branch simply stays empty).
  const onErr = (what: string) => (e: unknown) => console.error(`[query-explorer] failed to load ${what}`, e);
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const reloadQueries = async (): Promise<void> => {
    const [rows, gs] = await Promise.all([queryApi.list(), queryApi.groups()]);
    setQueries(rows); setGroups(gs);
  };

  useEffect(() => { if (openBranch.connectors && connectors.length === 0) queryApi.connectors().then(setConnectors).catch(onErr('connectors')); }, [openBranch.connectors]);
  useEffect(() => { if (openBranch.datasets && datasets.length === 0) queryApi.datasets().then(setDatasets).catch(onErr('datasets')); }, [openBranch.datasets]);
  useEffect(() => {
    if (!openBranch.queries) return;
    let cancelled = false;
    void Promise.all([queryApi.list(), queryApi.groups()])
      .then(([rows, gs]) => { if (!cancelled) { setQueries(rows); setGroups(gs); } })
      .catch(onErr('custom queries'));
    return () => { cancelled = true; };
  }, [openBranch.queries, savedRevision]);

  // Refresh in the explorer menu. Custom queries reload through savedRevision above. This drops the
  // cached connector, dataset, schema and table lists, and fetches again the ones that are open.
  const explorerRevision = useQueryStore((s) => s.explorerRevision);
  useEffect(() => {
    if (explorerRevision === 0) return;
    setConnectors([]); setDatasets([]); setDatabases({}); setSchemas({}); setTables({});
    if (openBranch.connectors) queryApi.connectors().then(setConnectors).catch(onErr('connectors'));
    if (openBranch.datasets) queryApi.datasets().then(setDatasets).catch(onErr('datasets'));
    for (const [k, open] of Object.entries(openBranch)) {
      if (!open) continue;
      if (k.startsWith('c:')) fetchDatabases(k.slice(2));
      else if (k.startsWith('d:')) fetchSchemasInto(scopeOf(k.slice(2)));
      else if (k.startsWith('s:')) {
        // A schema name is a bare identifier, so the last slash always splits scope from schema.
        const key = k.slice(2);
        const slash = key.lastIndexOf('/');
        fetchTablesInto(scopeOf(key.slice(0, slash)), key.slice(slash + 1));
      }
    }
  }, [explorerRevision]);

  const fetchSchemasInto = (scope: Scope) => {
    fetchSchemas(scope).then((sc) => setSchemas((m) => ({ ...m, [scopeKey(scope)]: sc }))).catch(onErr('schemas'));
  };
  const fetchTablesInto = (scope: Scope, schema: string) => {
    fetchTables(scope, schema).then((tb) => setTables((m) => ({ ...m, [`${scopeKey(scope)}/${schema}`]: tb }))).catch(onErr('tables'));
  };
  // A failed database listing falls back to the schemas of the connection's own database.
  const fetchDatabases = (id: string) => {
    queryApi.databases(id)
      .catch((e: unknown) => { onErr('databases')(e); return null; })
      .then((dbs) => {
        setDatabases((m) => ({ ...m, [id]: dbs }));
        if (dbs === null) fetchSchemasInto({ id });
      });
  };

  const loadConnector = (id: string) => { toggle(`c:${id}`); if (!(id in databases)) fetchDatabases(id); };
  const loadDatabase = (scope: Scope) => {
    const key = scopeKey(scope); toggle(`d:${key}`);
    if (!schemas[key]) fetchSchemasInto(scope);
  };
  const loadTables = (scope: Scope, schema: string) => {
    const key = `${scopeKey(scope)}/${schema}`; toggle(`s:${key}`);
    if (!tables[key]) fetchTablesInto(scope, schema);
  };

  const schemaRows = (c: ConnectorRef, scope: Scope, depth: number) => (schemas[scopeKey(scope)] ?? []).map((sc) => {
    const key = `${scopeKey(scope)}/${sc}`;
    return (
      <div key={sc}>
        <Row depth={depth} open={!!openBranch[`s:${key}`]} onClick={() => loadTables(scope, sc)} icon={<Package className="h-3.5 w-3.5" />} label={sc} />
        {openBranch[`s:${key}`] && (tables[key] ?? []).map((tb) => (
          <Row key={tb} depth={depth + 1} onClick={() => openTableTab({ connectorId: c.id, type: c.type ?? '', database: scope.database, schema: sc, table: tb })} icon={<Table2 className="h-3.5 w-3.5" />} label={tb} />
        ))}
      </div>
    );
  });

  // Deletes are confirmed via the shared shadcn ConfirmDialog rather than window.confirm.
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<CustomQueryGroup | null>(null);
  const [nameSheet, setNameSheet] = useState<NameSheet | null>(null);

  const doDelete = async (id: string): Promise<void> => {
    try {
      await queryApi.remove(id);
      const open = tabs.find((tb) => tb.kind === 'query' && tb.customQueryId === id);
      if (open) closeTab(open.id);
      setQueries(await queryApi.list());
    } catch (e) { onErr('delete query')(e); }
  };

  const doDeleteGroup = async (id: string): Promise<void> => {
    try { await queryApi.removeGroup(id); await reloadQueries(); }
    catch (e) { toast.error(t('query.groups.deleteFailed', { error: message(e) })); }
  };

  // Moves the row at once and puts it back if the server refuses.
  const move = async (queryId: string, groupId: string | null): Promise<void> => {
    const before = queries;
    setQueries((qs) => qs.map((q) => (q.id === queryId ? { ...q, groupId } : q)));
    if (groupId) setOpenBranch((o) => ({ ...o, [`g:${groupId}`]: true }));
    try { await queryApi.moveQuery(queryId, groupId); }
    catch (e) { setQueries(before); toast.error(t('query.groups.moveFailed', { error: message(e) })); }
  };

  const saveName = async (name: string): Promise<void> => {
    if (!nameSheet) return;
    if (nameSheet.kind === 'newGroup') {
      const { id } = await queryApi.createGroup(name);
      setOpenBranch((o) => ({ ...o, [`g:${id}`]: true }));
    } else if (nameSheet.kind === 'renameGroup') {
      await queryApi.renameGroup(nameSheet.group.id, name);
    } else {
      await queryApi.update(nameSheet.query.id, { name });
      const open = tabs.find((tb) => tb.kind === 'query' && tb.customQueryId === nameSheet.query.id);
      if (open) patchQuery(open.id, { title: name });
    }
    await reloadQueries();
  };

  // A small move starts a drag, so a plain click still opens the query. On touch, a long press
  // starts it, so the list still scrolls.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );
  const [dragging, setDragging] = useState<CustomQuery | null>(null);
  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id).slice(QUERY_DRAG.length);
    setDragging(queries.find((q) => q.id === id) ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const m = dropMove(String(e.active.id), e.over ? String(e.over.id) : null, queries);
    if (m) void move(m.queryId, m.groupId);
  };

  const grouped = groupQueries(queries, groups);

  const queryRow = (q: CustomQuery, depth: number) => (
    <DraggableQuery key={q.id} id={q.id}>
      <div className="min-w-0 flex-1">
        <Row depth={depth} onClick={() => openQueryTab({ customQueryId: q.id, title: q.name, connectorId: q.connectorId, sql: q.sql, params: q.params })} icon={<Zap className="h-3.5 w-3.5" />} label={q.name} />
      </div>
      <RowMenu label={t('query.groups.rowActions', { name: q.name })}>
        <DropdownMenuItem onSelect={() => setNameSheet({ kind: 'renameQuery', query: q })}>{t('query.rename')}</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('query.groups.moveTo')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {groups.map((g) => (
              <DropdownMenuItem key={g.id} disabled={q.groupId === g.id} onSelect={() => void move(q.id, g.id)}>
                <TruncatedText text={g.name} side="right" className="max-w-[14rem]" />
              </DropdownMenuItem>
            ))}
            {groups.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled={!q.groupId} onSelect={() => void move(q.id, null)}>{t('query.groups.noGroup')}</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteId(q.id)}>{t('query.deleteQuery')}</DropdownMenuItem>
      </RowMenu>
    </DraggableQuery>
  );

  return (
    <div className="flex h-full flex-col overflow-auto py-2 text-sm">
      <Row depth={0} open={!!openBranch.connectors} onClick={() => toggle('connectors')} icon={<Plug className="h-3.5 w-3.5" />} label={t('query.connectors')} />
      {openBranch.connectors && connectors.map((c) => (
        <div key={c.id}>
          <Row depth={1} open={!!openBranch[`c:${c.id}`]} onClick={() => loadConnector(c.id)} icon={<span>🗄</span>} label={c.name} />
          {openBranch[`c:${c.id}`] && (Array.isArray(databases[c.id])
            // A SQL Server connector with a blank database: databases, then schemas, then tables.
            ? (databases[c.id] ?? []).map((db) => {
              const scope: Scope = { id: c.id, database: db };
              const key = scopeKey(scope);
              return (
                <div key={db}>
                  <Row depth={2} open={!!openBranch[`d:${key}`]} onClick={() => loadDatabase(scope)} icon={<Database className="h-3.5 w-3.5" />} label={db} />
                  {openBranch[`d:${key}`] && schemaRows(c, scope, 3)}
                </div>
              );
            })
            : schemaRows(c, { id: c.id }, 2))}
        </div>
      ))}

      <Row depth={0} open={!!openBranch.datasets} onClick={() => toggle('datasets')} icon={<Package className="h-3.5 w-3.5" />} label={t('query.datasets')} />
      {openBranch.datasets && datasets.map((d) => (
        <Row key={d.id} depth={1} onClick={() => openDatasetTab({ name: d.name })} icon={<Table2 className="h-3.5 w-3.5" />} label={d.name} />
      ))}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        {/* Dropping a query on the branch row takes it out of its group. */}
        <DropTarget groupId={null}>
          <div className="group flex min-w-0 items-center">
            <div className="min-w-0 flex-1">
              <Row depth={0} open={!!openBranch.queries} onClick={() => toggle('queries')} icon={<Zap className="h-3.5 w-3.5" />} label={t('query.customQueries')} />
            </div>
            <RowMenu label={t('query.groups.branchActions')}>
              <DropdownMenuItem onSelect={() => setNameSheet({ kind: 'newGroup' })}>{t('query.groups.newGroup')}</DropdownMenuItem>
            </RowMenu>
          </div>
        </DropTarget>
        {openBranch.queries && (
          <>
            {grouped.groups.map(({ group: g, queries: inGroup }) => (
              <div key={g.id}>
                <DropTarget groupId={g.id}>
                  <div className="group flex min-w-0 items-center">
                    <div className="min-w-0 flex-1">
                      <Row depth={1} open={!!openBranch[`g:${g.id}`]} onClick={() => toggle(`g:${g.id}`)} icon={<Folder className="h-3.5 w-3.5" />} label={g.name} count={inGroup.length} />
                    </div>
                    <RowMenu label={t('query.groups.groupActions', { name: g.name })}>
                      <DropdownMenuItem onSelect={() => setNameSheet({ kind: 'renameGroup', group: g })}>{t('query.groups.rename')}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteGroup(g)}>{t('query.groups.delete')}</DropdownMenuItem>
                    </RowMenu>
                  </div>
                </DropTarget>
                {openBranch[`g:${g.id}`] && (inGroup.length > 0
                  ? inGroup.map((q) => queryRow(q, 2))
                  : <p className="py-1 pr-2 text-xs italic text-muted-foreground/70" style={{ paddingLeft: 8 + 2 * 14 + 20 }}>{t('query.groups.empty')}</p>)}
              </div>
            ))}
            {grouped.ungrouped.map((q) => queryRow(q, 1))}
          </>
        )}
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="flex items-center gap-1.5 rounded border border-border bg-popover px-2 py-1 text-sm shadow-md">
              <Zap className="h-3.5 w-3.5" />{dragging.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {nameSheet && (
        <QueryNameSheet
          initialName={nameSheet.kind === 'renameGroup' ? nameSheet.group.name : nameSheet.kind === 'renameQuery' ? nameSheet.query.name : ''}
          title={nameSheet.kind === 'newGroup' ? t('query.groups.newGroup') : nameSheet.kind === 'renameGroup' ? t('query.groups.rename') : t('query.renameQuery')}
          description={nameSheet.kind === 'renameQuery' ? undefined : t('query.groups.description')}
          existsMessage={nameSheet.kind === 'renameQuery' ? undefined : t('query.groups.nameExists')}
          onClose={() => setNameSheet(null)}
          onSave={saveName}
        />
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title={t('query.confirmDeleteQuery')}
        confirmLabel={t('query.deleteQuery')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => { const id = deleteId; setDeleteId(null); if (id) void doDelete(id); }}
      />
      <ConfirmDialog
        open={deleteGroup !== null}
        onOpenChange={(o) => { if (!o) setDeleteGroup(null); }}
        title={t('query.groups.confirmDelete', { name: deleteGroup?.name ?? '' })}
        description={t('query.groups.confirmDeleteBody')}
        confirmLabel={t('query.groups.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => { const g = deleteGroup; setDeleteGroup(null); if (g) void doDeleteGroup(g.id); }}
      />
    </div>
  );
}
