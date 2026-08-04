import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { listFacilities, deleteFacility, listPublishedForms, type Facility } from '@/api';
import { FacilityDialog } from '@/facilities/FacilityDialog';

export function Facilities() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasForm, setHasForm] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<Facility | null | undefined>(undefined); // undefined = closed
  const [confirming, setConfirming] = useState<Facility | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listFacilities());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Whether a published facilities form exists is a DIFFERENT empty state from having no
  // facilities. Three independent gates can each leave a lab with no usable form (page target
  // unavailable, a form that doesn't target `facilities`, or one still sitting as a draft) —
  // merging that into the plain "no facilities yet" message is how the misconfiguration stays
  // invisible, so it gets its own title that names the cause and a link to go fix it.
  useEffect(() => {
    let cancelled = false;
    void listPublishedForms('facilities')
      .then((forms) => { if (!cancelled) setHasForm(forms.length > 0); })
      .catch(() => { if (!cancelled) setHasForm(false); });
    return () => { cancelled = true; };
  }, []);

  const upsert = (f: Facility) => setRows((prev) => {
    const i = prev.findIndex((r) => r.id === f.id);
    if (i === -1) return [...prev, f];
    const next = [...prev]; next[i] = f; return next;
  });

  const doDelete = useCallback(async () => {
    if (!confirming) return;
    const f = confirming;
    setConfirming(null);
    try {
      await deleteFacility(f.id);
      setRows((prev) => prev.filter((r) => r.id !== f.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [confirming]);

  if (loading || hasForm === null) {
    return (
      <AppShell title={t('nav.facilities')} fullBleed>
        <LoadingState className="flex-1" label={t('common.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell title={t('nav.facilities')} fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium">{t('facilities.title')}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('facilities.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!hasForm} onSelect={() => setEditing(null)}>
                {t('facilities.add')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {error && (
          <div className="mx-4 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          {!hasForm ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6" />}
              title={t('facilities.noForm')}
              body={t('facilities.noFormHelp')}
              action={<Link to="/forms" className="text-xs underline underline-offset-2">{t('facilities.openForms')}</Link>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6" />}
              title={t('facilities.empty')}
              body={t('facilities.emptyHelp')}
              action={<Button size="sm" onClick={() => setEditing(null)}>{t('facilities.add')}</Button>}
            />
          ) : (
            <Table wrapperClassName="min-h-0 flex-1">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>{t('facilities.code')}</TableHead>
                  <TableHead>{t('facilities.name')}</TableHead>
                  <TableHead>{t('facilities.region')}</TableHead>
                  <TableHead>{t('facilities.district')}</TableHead>
                  <TableHead>{t('facilities.status')}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((f) => (
                  <TableRow
                    key={f.id}
                    className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    onClick={() => setEditing(f)}
                  >
                    <TableCell className="text-xs">{f.localCode ?? f.nationalCode ?? '—'}</TableCell>
                    <TableCell className="text-xs">{f.name}</TableCell>
                    <TableCell className="text-xs">{f.region ?? '—'}</TableCell>
                    <TableCell className="text-xs">{f.district ?? '—'}</TableCell>
                    <TableCell className="text-xs">{f.status ?? '—'}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`${t('facilities.actions')} ${f.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(f)}>{t('common.edit')}</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirming(f)}>
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {editing !== undefined && (
          <FacilityDialog
            open
            facility={editing}
            onOpenChange={(o) => { if (!o) setEditing(undefined); }}
            onSaved={(f) => { upsert(f); setEditing(undefined); }}
          />
        )}

        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(o) => { if (!o) setConfirming(null); }}
          title={t('facilities.deleteTitle', { name: confirming?.name ?? '' })}
          description={t('facilities.deleteBody', { name: confirming?.name ?? '' })}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={() => { void doDelete(); }}
        />
      </div>
    </AppShell>
  );
}

export default Facilities;
