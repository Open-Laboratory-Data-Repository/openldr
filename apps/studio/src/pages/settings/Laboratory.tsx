import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  fetchLabIdentity, saveLabIdentity, listFacilityImportSources,
  type LabIdentity, type LabIdentityResponse, type FacilityRegisterSource,
} from '@/api';

const LOGO_KEY = 'lab.logo';
const TIMEZONE_KEY = 'lab.timezone';

/**
 * Settings ▸ Laboratory — the identity printed on every report letterhead.
 *
 * Its own page rather than another section of General, which already carries About, feature flags,
 * number limits and the danger zone. Four fields, one of them an upload.
 *
 * ⚠ The field list and the logo limits come FROM THE SERVER. `@openldr/config` re-exports an env
 * loader that reads process.env, so studio cannot import the registry — the same reason the feature
 * flags page renders from its API response rather than from FEATURE_FLAGS.
 */
export function Laboratory(): JSX.Element {
  const { t } = useTranslation();
  const [meta, setMeta] = useState<LabIdentityResponse | null>(null);
  const [values, setValues] = useState<LabIdentity>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** ⛔ The LOAD failure only, because that one is not transient: it replaces the whole page below.
   *  Everything else this page reports (a save, a rejected logo) is a toast, matching Connectors and
   *  DataExposure. It used to be a line of grey text under the form, which is where the operator
   *  found it, below the fold. */
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The registers this install knows about — the only values the facility-system picker may offer.
  // Active-only, matching the import sheet's own picklist: offering a deactivated register here
  // would let Settings hand the Facility form a value the route then refuses.
  const [registers, setRegisters] = useState<FacilityRegisterSource[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchLabIdentity()
      .then((r) => { if (!cancelled) { setMeta(r); setValues(r.values); } })
      .catch(() => { if (!cancelled) setError(t('settings.laboratory.loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    // A failure here degrades the picker to an empty list, never the whole page: the letterhead
    // fields have nothing to do with facility registers.
    void listFacilityImportSources()
      .then((rows) => { if (!cancelled) setRegisters(rows); })
      .catch(() => { if (!cancelled) setRegisters([]); });
    return () => { cancelled = true; };
  }, []);

  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  /**
   * Read the chosen file into a data URI.
   *
   * ⚠ Checked HERE as well as on the server, because this is the only place the operator can see
   * WHY. The renderer cannot help: pdfkit takes a URL image source as a FILE PATH, so a bad logo
   * becomes a silent dashed box in the PDF rather than an error anyone reads.
   */
  const onLogoFile = (file: File | undefined) => {
    if (!file || !meta) return;
    if (!meta.logo.mimeTypes.includes(file.type)) { toast.error(t('settings.laboratory.logoType')); return; }
    if (file.size > meta.logo.maxBytes) {
      toast.error(t('settings.laboratory.logoTooBig', { max: Math.round(meta.logo.maxBytes / 1024) })); return;
    }
    const reader = new FileReader();
    reader.onload = () => { set(LOGO_KEY, String(reader.result ?? '')); };
    reader.onerror = () => toast.error(t('settings.laboratory.logoReadError'));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!meta) return;
    setSaving(true);
    try {
      const patch: LabIdentity = {};
      for (const f of meta.fields) patch[f.id] = values[f.id] ?? '';
      // The PUT answers with the values map itself, not with the GET's `{ fields, values, logo }`
      // envelope. See `saveLabIdentity` for what reading `.values` here cost.
      setValues(await saveLabIdentity(patch));
      toast.success(t('settings.laboratory.saved'));
    } catch {
      toast.error(t('settings.laboratory.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!meta) return <p className="p-4 text-xs text-destructive">{error ?? t('settings.laboratory.loadError')}</p>;

  const logo = values[LOGO_KEY] ?? '';

  return (
    /* ⛔ This page owns its own scroll region. SettingsShell's outlet is `overflow-hidden` on
       purpose (a scroller there AND one here gave two nested scrollers, the Distributed-sync
       defect), so a page without one is simply CLIPPED. That is what happened here: on a phone the
       Logo row sat below the cut and nothing on the page could scroll. `min-h-0` + `flex-1` are what
       let this box shrink to the outlet instead of overflowing it. Ref: General.tsx, DataExposure.tsx. */
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="laboratory-page">
      {/* ⛔ Save lives in the ⋯ menu, never as a standalone button. AGENTS.md section 5: page-header,
          sheet and per-row actions all go in a MoreHorizontal DropdownMenu. Ref:
          pages/settings/Connectors.tsx, the header menu this copies. */}
      <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold">{t('settings.laboratory.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('settings.laboratory.description')}</p>
        {/* ⚠ The token syntax is STATIC JSX, never t(). An i18n string containing `{{lab.name}}` is
            parsed by i18next as an interpolation and renders as an empty gap — the same defect that
            shipped "{{min}}" literally in the barcode hint. Token names are not translatable anyway. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {t('settings.laboratory.tokensHint')}{' '}
          <code className="text-[11px]">{'{{lab.name}} {{lab.address}} {{lab.contact}} {{lab.logo}}'}</code>
        </p>
      </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('common.actions')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={saving} onSelect={() => { void save(); }}>
              {t('settings.laboratory.save')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ⛔ `minmax(0,1fr)`, NOT `1fr`. A bare `1fr` is `minmax(auto,1fr)`, and the auto floor is the
          control's OWN min-content — an Input/Textarea/SelectTrigger will not go under ~236px. With a
          fixed 10rem label column that pinned the form at 428px intrinsic, so on any phone narrower than
          that the inputs ran off the right edge with no horizontal scroller to reach them. `auto` on the
          label column is the AGENTS.md section 5 shape (ref Connectors.tsx); the `minmax(0,...)` is what
          actually lets the controls shrink. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
        {meta.fields.filter((f) => f.id !== LOGO_KEY).map((f) => (
          /* ⛔ A PICKER, never a text box. `idFor` hashes this register's URI into every facility's
             permanent id WITHOUT normalising it, so a typed label ('HFR' vs 'hfr') mints a second
             identity for one register — the defect migration 082 had to clean up. Only a register
             that already exists on this install can be chosen. */
          f.source === 'facility-registers' ? (
            <FieldRow key={f.id} id={f.id} label={t(f.labelKey)}>
              <Select value={values[f.id] ?? ''} onValueChange={(v) => set(f.id, v)}>
                <SelectTrigger id={f.id} aria-label={t(f.labelKey)} className="h-8 text-xs">
                  <SelectValue placeholder={t('settings.laboratory.facilitySystemPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {registers.map((r) => (
                    <SelectItem key={r.url} value={r.url}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          ) : f.multiline ? (
            <FieldRow key={f.id} id={f.id} label={t(f.labelKey)} alignTop>
              <Textarea id={f.id} aria-label={t(f.labelKey)} value={values[f.id] ?? ''}
                onChange={(e) => set(f.id, e.target.value)} className="min-h-[64px] text-xs" />
            </FieldRow>
          ) : (
            <FieldRow key={f.id} id={f.id} label={t(f.labelKey)} alignTop={f.id === TIMEZONE_KEY}>
              <div className="flex flex-col gap-1">
                <Input id={f.id} aria-label={t(f.labelKey)} value={values[f.id] ?? ''}
                  onChange={(e) => set(f.id, e.target.value)} className="h-8 text-xs" />
                {/* ⛔ The validator takes IANA names ONLY (packages/config/src/lab-identity.ts).
                    SQL Server's `AT TIME ZONE` takes Windows names, so on that warehouse this
                    setting cannot hold a usable value and the operator must supply the zone on
                    the report run instead. Said here because nothing else on the page would. */}
                {f.id === TIMEZONE_KEY && (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t('settings.laboratory.timezoneHint')}
                  </p>
                )}
              </div>
            </FieldRow>
          )
        ))}

        <span className="self-start pt-2 text-xs text-muted-foreground">{t('settings.laboratory.logo')}</span>
        {/* `flex-wrap` because this row is three fixed-width things — the 48px preview and two
            whitespace-nowrap buttons — that together outrun the control column on a 320px phone and
            pushed Clear past the right padding. Wrapping, not sideways scrolling: a portalled scroller
            here would be unreachable if this page ever renders inside a sheet. */}
        <div className="flex flex-wrap items-center gap-3">
          {logo
            ? <img src={logo} alt={t('settings.laboratory.logo')} className="h-12 w-12 border border-border object-contain" />
            : <div className="flex h-12 w-12 items-center justify-center border border-dashed border-border text-[10px] text-muted-foreground">—</div>}
          <input ref={fileRef} type="file" data-testid="logo-file" aria-label={t('settings.laboratory.chooseLogo')}
            className="hidden" accept={meta.logo.mimeTypes.join(',')} onChange={(e) => onLogoFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            {t('settings.laboratory.chooseLogo')}
          </Button>
          {logo && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set(LOGO_KEY, '')}>
              {t('settings.laboratory.clearLogo')}
            </Button>
          )}
        </div>
      </div>


    </div>
  );
}

/** Label-left / control-right, the established settings-form shape. */
function FieldRow({ id, label, alignTop, children }: {
  id: string; label: string; alignTop?: boolean; children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <label className={`text-xs text-muted-foreground${alignTop ? ' self-start pt-2' : ''}`} htmlFor={id}>{label}</label>
      {children}
    </>
  );
}

export default Laboratory;
