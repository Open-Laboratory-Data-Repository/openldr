import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getFormVersion, listFormVersions, type FormVersionSummary } from '../api';
import { diffFormSchemas, normalizeFormSchema, type FormSchema, type FormSchemaDiff } from '@openldr/forms/pure';

interface CompareRow {
  key: string;
  label: string;
  kind: string;
}

function flattenDiff(diff: FormSchemaDiff): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const change of diff.metadata) {
    rows.push({ key: `metadata-${change.path}`, label: `Metadata · ${change.path}`, kind: change.kind });
  }
  for (const change of diff.sections) {
    const suffix = change.kind === 'changed' ? ` · ${change.path}` : '';
    rows.push({ key: `section-${change.sectionId}-${change.kind}-${'path' in change ? change.path : ''}`, label: `Section ${change.sectionId}${suffix}`, kind: change.kind });
  }
  for (const change of diff.fields) {
    const suffix = change.kind === 'changed' ? ` · ${change.path}` : '';
    rows.push({ key: `field-${change.fieldId}-${change.kind}-${'path' in change ? change.path : ''}`, label: `Field ${change.fieldId}${suffix}`, kind: change.kind });
  }
  return rows;
}

type Side = 'draft' | number;

/** Resolve one side of the comparison to a schema. */
async function sideSchema(formId: string, side: Side, current: FormSchema): Promise<FormSchema> {
  if (side === 'draft') return current;
  const snapshot = await getFormVersion(formId, side);
  return normalizeFormSchema(snapshot.schema);
}

/** Display label for one side, matching how the selector renders that option. */
function sideLabel(side: Side, versions: FormVersionSummary[]): string {
  if (side === 'draft') return 'Current draft';
  const version = versions.find((v) => v.version === side);
  return version?.versionLabel ? `v${side} (${version.versionLabel})` : `v${side}`;
}

export function CompareDialog({ formId, current, open, onOpenChange }: { formId: string | null; current: FormSchema; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [left, setLeft] = useState<Side | null>(null);
  const [right, setRight] = useState<Side>('draft');
  const [leftSchema, setLeftSchema] = useState<FormSchema | null>(null);
  const [rightSchema, setRightSchema] = useState<FormSchema | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);

  // Load the version list once per open, and seed the left side with the newest published
  // version so the dialog opens on exactly what it used to show.
  useEffect(() => {
    if (!open || !formId) return;
    let cancelled = false;
    setListError(null);
    void listFormVersions(formId)
      .then((loaded) => {
        if (cancelled) return;
        setVersions(loaded);
        setLeft(loaded[0] ? loaded[0].version : null);
        setRight('draft');
      })
      .catch((err) => {
        // A failed fetch is not the same claim as "never published". Show the error, not the
        // empty state, so a transient failure does not read as a permanent fact about the form.
        if (cancelled) return;
        setListError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [open, formId]);

  // Refetch the left side when it moves, or when the draft changes and the left side is the draft.
  useEffect(() => {
    if (!open || !formId || left === null) return;
    let cancelled = false;
    setLeftError(null);
    void sideSchema(formId, left, current)
      .then((schema) => {
        if (!cancelled) setLeftSchema(schema);
      })
      .catch((err) => {
        // Leaving the old schema in place would silently describe a comparison that is not
        // the one selected, so drop it and show the error instead.
        if (cancelled) return;
        setLeftSchema(null);
        setLeftError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formId, left, left === 'draft' ? current : null]);

  // Refetch the right side when it moves, or when the draft changes and the right side is the draft.
  useEffect(() => {
    if (!open || !formId) return;
    let cancelled = false;
    setRightError(null);
    void sideSchema(formId, right, current)
      .then((schema) => {
        if (!cancelled) setRightSchema(schema);
      })
      .catch((err) => {
        if (cancelled) return;
        setRightSchema(null);
        setRightError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formId, right, right === 'draft' ? current : null]);

  // Derived, not stored: recomputes only when one of the two resolved schemas changes.
  const rows = useMemo(() => {
    if (!leftSchema || !rightSchema) return [];
    return flattenDiff(diffFormSchemas(leftSchema, rightSchema));
  }, [leftSchema, rightSchema]);

  const leftLabel = left !== null ? sideLabel(left, versions) : '';
  const rightLabel = sideLabel(right, versions);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Compare form versions</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {listError ? (
              <span className="text-destructive">Could not load versions.</span>
            ) : versions.length > 0 ? (
              <>
                <span className="font-medium text-foreground">{leftLabel}</span> vs{' '}
                <span className="font-medium text-foreground">{rightLabel}</span>
              </>
            ) : (
              'No published versions yet.'
            )}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Select
              value={String(left ?? '')}
              onValueChange={(v) => setLeft(v === 'draft' ? 'draft' : Number(v))}
            >
              <SelectTrigger className="w-44 text-xs" aria-label="Compare from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Current draft</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={String(v.version)}>
                    {v.versionLabel ? `v${v.version} (${v.versionLabel})` : `v${v.version}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">to</span>
            <Select
              value={right === 'draft' ? 'draft' : String(right)}
              onValueChange={(v) => setRight(v === 'draft' ? 'draft' : Number(v))}
            >
              <SelectTrigger className="w-44 text-xs" aria-label="Compare to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Current draft</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={String(v.version)}>
                    {v.versionLabel ? `v${v.version} (${v.versionLabel})` : `v${v.version}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {listError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-destructive">Could not load versions</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{listError}</p>
          </div>
        ) : versions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">No published versions yet</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Publish this form to create a snapshot you can compare the current draft against.
            </p>
          </div>
        ) : leftError || rightError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-destructive">Could not load the comparison</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{leftError || rightError}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">No differences</p>
            <p className="mt-1 text-xs text-muted-foreground">{leftLabel} matches {rightLabel}.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-6 py-2 text-xs text-muted-foreground">
              <span>{rows.length} change{rows.length === 1 ? '' : 's'} between {leftLabel} and {rightLabel}</span>
            </div>
            <div className="max-h-[55vh] divide-y divide-border overflow-auto">
              {rows.map((row) => {
                const meta = kindMeta(row.kind);
                return (
                  <div key={row.key} className="flex items-start gap-3 px-6 py-2.5">
                    <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <span className="text-sm leading-5">{row.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function kindMeta(kind: string): { label: string; cls: string } {
  if (kind === 'added') return { label: 'Added', cls: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600' };
  if (kind === 'removed') return { label: 'Removed', cls: 'border-destructive/30 bg-destructive/15 text-destructive' };
  return { label: 'Changed', cls: 'border-amber-500/30 bg-amber-500/15 text-amber-600' };
}
