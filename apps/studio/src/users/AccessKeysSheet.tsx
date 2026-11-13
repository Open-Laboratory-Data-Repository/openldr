import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { createAccessKey, listAccessKeys, revokeAccessKey, type AccessKey } from '@/api';

// Matches NAME_MAX_LENGTH in packages/bootstrap/src/access-keys.ts. The server checks it too.
const NAME_MAX_LENGTH = 80;

/** A picked day (`yyyy-MM-dd`, as DatePicker gives it) as the last millisecond of that day in the
 *  browser's time zone, in full ISO form. The server refuses an expiry without a time and zone. */
export function endOfDayIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

type KeyStatus = 'active' | 'revoked' | 'expired';

function statusOf(k: AccessKey, now: number): KeyStatus {
  if (k.revokedAt) return 'revoked';
  if (k.expiresAt && Date.parse(k.expiresAt) <= now) return 'expired';
  return 'active';
}

function formatDate(iso: string | null, withTime: boolean): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface AccessKeysSheetProps {
  /** The account whose keys are shown. Null closes the sheet. */
  user: { id: string; username: string } | null;
  onClose: () => void;
}

/** Lists, makes and revokes one account's access keys. A new key lives only in the body's state,
 *  and the body unmounts when the sheet closes, so closing the sheet drops the key. */
export function AccessKeysSheet({ user, onClose }: AccessKeysSheetProps) {
  return (
    <Sheet open={user !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl lg:max-w-3xl">
        {user && <AccessKeysBody key={user.id} user={user} />}
      </SheetContent>
    </Sheet>
  );
}

function AccessKeysBody({ user }: { user: { id: string; username: string } }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed create or revoke. Kept apart from loadError, so the reload after a failed revoke
  // does not wipe the revoke's message when the reload works.
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The new key. Never put anywhere else: not storage, the URL, a toast or the console.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pendingRevoke, setPendingRevoke] = useState<AccessKey | null>(null);
  const keyField = useRef<HTMLTextAreaElement>(null);
  const request = useRef(0);
  const createBusy = useRef(false);
  const today = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const rows = await listAccessKeys(user.id);
      if (id === request.current) { setKeys(rows); setLoadError(null); }
    } catch (e) {
      if (id === request.current) setLoadError(t('users.accessKeys.loadError', { error: errorText(e) }));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [user.id, t]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);

  const trimmed = name.trim();

  const openForm = () => { setFormOpen(true); setError(null); };
  const closeForm = () => { setFormOpen(false); setName(''); setExpiry(null); };

  const onCreate = async () => {
    // The ref, not the state, stops a second create: Enter and the menu item can fire in one render.
    if (!trimmed || createBusy.current) return;
    createBusy.current = true;
    setCreating(true);
    setError(null);
    try {
      const { key } = await createAccessKey(user.id, { name: trimmed, expiresAt: expiry ? endOfDayIso(expiry) : null });
      setRevealed(key);
      setCopyState('idle');
      closeForm();
      void load();
    } catch (e) {
      setError(t('users.accessKeys.createError', { error: errorText(e) }));
    } finally {
      createBusy.current = false;
      setCreating(false);
    }
  };

  // navigator.clipboard is missing on a plain HTTP page that is not localhost, as over Tailscale.
  // Then, or when its write is refused, select the field and use the older execCommand copy.
  // If that fails too, the key stays selected and the sheet says to copy it by hand.
  const copy = async () => {
    if (!revealed) return;
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(revealed);
        setCopyState('copied');
        return;
      } catch { /* fall back below */ }
    }
    const field = keyField.current;
    field?.focus();
    field?.select();
    let copied = false;
    try {
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch {
      copied = false;
    }
    setCopyState(copied ? 'copied' : 'failed');
  };

  const doRevoke = async () => {
    const k = pendingRevoke;
    if (!k) return;
    setPendingRevoke(null);
    setError(null);
    try {
      await revokeAccessKey(user.id, k.id);
    } catch (e) {
      setError(t('users.accessKeys.revokeError', { error: errorText(e) }));
    }
    // Read the list either way: a failed revoke may mean the key was revoked elsewhere.
    void load();
  };

  const now = Date.now();
  const pageRows = keys.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <>
      <SheetHeader className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-2 pr-6">
          <SheetTitle className="min-w-0 break-words">{t('users.accessKeys.title', { username: user.username })}</SheetTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('users.accessKeys.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openForm}>{t('users.accessKeys.newKey')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <SheetDescription>{t('users.accessKeys.description')}</SheetDescription>
      </SheetHeader>

      {/* A failed reload over rows already shown goes here; with no rows it shows in the table area. */}
      {[error, keys.length > 0 ? loadError : null].filter(Boolean).map((text) => (
        <div key={text} className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]">{text}</div>
      ))}

      {revealed && (
        <section className="border-b border-border px-6 py-4">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
            <Label htmlFor="access-key-value" className="whitespace-nowrap pt-2">{t('users.accessKeys.key')}</Label>
            <div className="flex min-w-0 items-start gap-2">
              {/* A wrapping field, so the whole key shows and can be selected by hand. */}
              <Textarea
                id="access-key-value"
                ref={keyField}
                readOnly
                rows={3}
                value={revealed}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-0 min-w-0 break-all font-mono text-xs [overflow-wrap:anywhere]"
              />
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label={t('users.accessKeys.copy')} onClick={() => { void copy(); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs text-foreground">{t('users.accessKeys.shownOnce')}</p>
          {copyState === 'failed' && <p className="mt-1 text-xs text-muted-foreground">{t('users.accessKeys.copyByHand')}</p>}
          {copyState === 'copied' && <p aria-live="polite" className="mt-1 text-xs text-emerald-700">{t('users.accessKeys.copied')}</p>}
        </section>
      )}

      {formOpen && (
        <section className="border-b border-border">
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="text-sm font-medium text-foreground">{t('users.accessKeys.newKey')}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('users.accessKeys.formActions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!trimmed || creating} onSelect={() => { void onCreate(); }}>{t('users.accessKeys.create')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={closeForm}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Not a <form>: the date picker's trigger is a button and would submit it. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-t border-border px-6 py-4">
            <Label htmlFor="access-key-name" className="whitespace-nowrap">{t('users.accessKeys.name')}</Label>
            <Input
              id="access-key-name"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onCreate(); } }}
            />
            <Label htmlFor="access-key-expiry" className="whitespace-nowrap">{t('users.accessKeys.expires')}</Label>
            <div className="flex min-w-0 flex-col gap-1">
              <DatePicker id="access-key-expiry" value={expiry} onChange={setExpiry} minDate={today} placeholder={t('users.accessKeys.noExpiry')} />
              <p className="text-xs text-muted-foreground">{t('users.accessKeys.expiryHint')}</p>
            </div>
          </div>
        </section>
      )}

      {/* Fill only when rows exist: the loading and empty states fill on their own. */}
      <div className="flex min-h-[16rem] flex-1 flex-col">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {/* A failed load is not "no keys": show why, without the stripes that mean empty. */}
        {!loading && keys.length === 0 && loadError && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-xs text-destructive [overflow-wrap:anywhere]">{loadError}</div>
        )}
        {!loading && keys.length === 0 && !loadError && <StripedEmpty className="min-h-[16rem] flex-1">{t('users.accessKeys.empty')}</StripedEmpty>}
        {!loading && keys.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3">{t('users.accessKeys.colName')}</TableHead>
                <TableHead className="hidden px-3 sm:table-cell">{t('users.accessKeys.colPrefix')}</TableHead>
                <TableHead className="hidden px-3 lg:table-cell">{t('users.accessKeys.colCreated')}</TableHead>
                <TableHead className="hidden px-3 sm:table-cell">{t('users.accessKeys.colExpires')}</TableHead>
                <TableHead className="hidden px-3 lg:table-cell">{t('users.accessKeys.colLastUsed')}</TableHead>
                <TableHead className="w-24 px-3">{t('users.accessKeys.colStatus')}</TableHead>
                <TableHead className="w-12 px-2"><span className="sr-only">{t('common.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {pageRows.map((k) => {
                const status = statusOf(k, now);
                return (
                  <TableRow key={k.id}>
                    <TableCell className="px-3">
                      {/* overflow-wrap:anywhere, not break-words: only it lets a table cell shrink
                          below a long unbroken name. */}
                      <span className="block font-medium [overflow-wrap:anywhere]">{k.name}</span>
                      {/* The prefix column is hidden on a phone, so the prefix sits under the name. */}
                      <span className="block font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere] sm:hidden">{k.prefix}</span>
                    </TableCell>
                    <TableCell className="hidden px-3 font-mono text-xs text-muted-foreground sm:table-cell">{k.prefix}</TableCell>
                    <TableCell className="hidden whitespace-nowrap px-3 text-xs text-muted-foreground lg:table-cell">{formatDate(k.createdAt, false)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap px-3 text-xs text-muted-foreground sm:table-cell">{formatDate(k.expiresAt, false)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap px-3 text-xs text-muted-foreground lg:table-cell">{formatDate(k.lastUsedAt, true)}</TableCell>
                    <TableCell className="px-3">
                      {status === 'active'
                        ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">{t('users.accessKeys.statusActive')}</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">{t(status === 'revoked' ? 'users.accessKeys.statusRevoked' : 'users.accessKeys.statusExpired')}</Badge>}
                    </TableCell>
                    <TableCell className="px-2 text-right">
                      {/* An expired row keeps Revoke: the status uses this browser's clock, and the
                          server may still accept a key a fast clock calls expired. */}
                      {status !== 'revoked' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('users.accessKeys.rowActions', { name: k.name })}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setPendingRevoke(k)}>
                              {t('users.accessKeys.revoke')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={keys.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => { if (!o) setPendingRevoke(null); }}
        title={t('users.accessKeys.revokeTitle', { name: pendingRevoke?.name ?? '' })}
        description={t('users.accessKeys.revokeDescription')}
        confirmLabel={t('users.accessKeys.revoke')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => { void doRevoke(); }}
      />
    </>
  );
}
