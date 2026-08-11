import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingState } from '@/components/ui/spinner';
import { getFacilityHistory, type FacilityHistoryEntry } from '@/api';
import { FACILITY_STATUS_VALUESET_ID, FACILITY_LEVEL_VALUESET_ID, useCodeDisplayMap, displayFor } from './facility-code-labels';

/** Task 10: the four actions `GET /api/facilities/:id/history` can return, mapped to the i18n key
 *  holding each one's label.
 *
 *  ⚠ NOT because these are the only actions written with `entityType: 'facility'` — an earlier
 *  version of this comment claimed that and it is wrong. MEASURED on this branch: ten distinct
 *  actions are written with that entity type (facility.create/update/delete, facility.import.row,
 *  facility.import, facility.import.uploaded/confirmed/cancelled, facility.scan, facility.publish)
 *  across fifteen call sites in apps/server, packages/cli and packages/bootstrap. What makes this
 *  set the reachable one is the route's OTHER predicate: it filters `entity_id = :id`, and only
 *  these four ever use a facility's own id there. The rest name the operation
 *  ('facility-observed:all-feeds'), the register's canonical URI, or an import-run id — none of
 *  which can equal a facility id.
 *
 *  An action outside this set therefore should not appear, but if one ever does it falls back to the
 *  raw string rather than a broken-looking translation lookup. */
const ACTION_LABEL_KEYS: Record<string, string> = {
  'facility.create': 'facilities.history.actions.create',
  'facility.update': 'facilities.history.actions.update',
  'facility.delete': 'facilities.history.actions.delete',
  'facility.import.row': 'facilities.history.actions.importRow',
};

/** A single changed field between `before` and `after` — `field` is the raw record key
 *  (`status`, `phone`, ...), `before`/`after` are that key's RAW values (label resolution happens
 *  at render time, not here, so this stays reusable regardless of which fields carry a terminology
 *  label). */
export interface FieldDiff { field: string; before: unknown; after: unknown }

/** Fix wave (Task 10): `null`/`undefined` collapse to the SAME normalised `null` before comparing,
 *  so a key one side never mentions and a key the other side explicitly nulled out never register
 *  as "changed". A `create` (`before === null`) or `delete` (`after === null`) reports every key
 *  the surviving side carries as changed — there is no prior/subsequent state to diff against, so
 *  every field IS the change. Sorted by field name so rendering is deterministic regardless of the
 *  writer's own JSON key order. */
export function diffFacilityRecord(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldDiff[] {
  if (before === null && after === null) return [];
  const keys = new Set([
    ...(before ? Object.keys(before) : []),
    ...(after ? Object.keys(after) : []),
  ]);
  const diffs: FieldDiff[] = [];
  for (const key of keys) {
    const b = (before ? before[key] : null) ?? null;
    const a = (after ? after[key] : null) ?? null;
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    diffs.push({ field: key, before: b, after: a });
  }
  return diffs.sort((x, y) => x.field.localeCompare(y.field));
}

/** `v` formatted for the diff line — `null` (never set / just cleared) reads as an em dash, never
 *  the literal "null". Mirrors `ImportFacilitiesSheet.tsx`'s own `fmtDiffValue` (not imported: that
 *  one is a private, unexported local — same "mirrored, not shared" reasoning the rest of this
 *  app's api.ts follows for server-defined shapes). */
function fmtDiffValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** `status`/`level` carry a canonical CODE (`active`, `dispensary`, ...), not something an operator
 *  reading a change log should have to decode — this resolves those two fields' before/after values
 *  through their terminology display label (Task 10's "status and level render their display
 *  labels, not their stored codes"). Every other field renders its raw value via `fmtDiffValue`. */
function fmtFieldValue(field: string, value: unknown, statusMap: Map<string, string>, levelMap: Map<string, string>): string {
  if (value === null || value === undefined) return '—';
  if (field === 'status' && typeof value === 'string') return displayFor(statusMap, value);
  if (field === 'level' && typeof value === 'string') return displayFor(levelMap, value);
  return fmtDiffValue(value);
}

function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Task 10 (B1, facility-canonical-identity): "what has happened to it" — a read-only Sheet over
 * `GET /api/facilities/:id/history` (Task 8's read model on `audit_events`; this component captures
 * nothing itself). Newest first, exactly the order the route already returns rows in — no client
 * re-sort, so this can never disagree with the server's own tiebreak (`occurred_at` desc, `id` desc
 * — see that route's doc comment for why `id` is the second key).
 *
 * Reachable from the Registry table's per-row ⋯ menu (Facilities.tsx) — that menu is rendered
 * unconditionally (not `facilities.manage`-gated) precisely so History stays reachable to a
 * `facilities.view`-only actor, matching `GET /api/facilities/:id/history`'s own capability
 * requirement; Edit/Delete remain inside that menu's separate `canManage` guard (see that file's
 * own comment above its per-row menu for the detail).
 *
 * No ⋯ actions menu of its own: unlike every other Sheet in this app (which has a genuine Save/
 * Cancel to route through one, per ui-actions-in-dots-menu), this view has nothing to DO besides
 * close — the Sheet's own built-in ✕ already covers that, so adding a menu here would be a menu
 * with one item that duplicates a control the primitive already provides.
 */
export function FacilityHistory({ open, onOpenChange, facilityId, facilityName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  facilityName: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<FacilityHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusMap = useCodeDisplayMap(FACILITY_STATUS_VALUESET_ID);
  const levelMap = useCodeDisplayMap(FACILITY_LEVEL_VALUESET_ID);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFacilityHistory(facilityId)
      .then((page) => { if (!cancelled) setRows(page.rows); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, facilityId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('facilities.history.title')}</SheetTitle>
          <SheetDescription>{t('facilities.history.description', { name: facilityName })}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <LoadingState label={t('common.loading')} />}

          {error && !loading && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <p className="px-1 py-4 text-xs text-muted-foreground">{t('facilities.history.empty')}</p>
          )}

          {!loading && !error && rows.length > 0 && (
            <ul className="space-y-3">
              {rows.map((row, i) => {
                const diffs = diffFacilityRecord(row.before, row.after);
                const actionKey = ACTION_LABEL_KEYS[row.action];
                return (
                  // `occurredAt` + `action` is not guaranteed unique (Task 7's per-row import audit
                  // can write several rows within the same millisecond, exactly the collision the
                  // route's own `id` tiebreak exists for) — index is safe here because `rows` is
                  // fetched whole and never reordered/filtered client-side.
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className="rounded-md border border-border px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{actionKey ? t(actionKey) : row.action}</span>
                      <span className="text-muted-foreground">{formatOccurredAt(row.occurredAt)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {row.actorName ?? t('facilities.history.unknownActor')}
                    </div>
                    {diffs.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {diffs.map((d) => (
                          <li key={d.field}>
                            {t('facilities.import.changedFieldDiff', {
                              field: d.field,
                              before: fmtFieldValue(d.field, d.before, statusMap, levelMap),
                              after: fmtFieldValue(d.field, d.after, statusMap, levelMap),
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default FacilityHistory;
