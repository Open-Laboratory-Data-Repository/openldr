import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { fetchLabIdentity, saveLabIdentity, type LabIdentity, type LabIdentityResponse } from '@/api';

const LOGO_KEY = 'lab.logo';

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
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLabIdentity()
      .then((r) => { if (!cancelled) { setMeta(r); setValues(r.values); } })
      .catch(() => { if (!cancelled) setError(t('settings.laboratory.loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
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
    if (!meta.logo.mimeTypes.includes(file.type)) { setError(t('settings.laboratory.logoType')); return; }
    if (file.size > meta.logo.maxBytes) {
      setError(t('settings.laboratory.logoTooBig', { max: Math.round(meta.logo.maxBytes / 1024) })); return;
    }
    const reader = new FileReader();
    reader.onload = () => { setError(null); set(LOGO_KEY, String(reader.result ?? '')); };
    reader.onerror = () => setError(t('settings.laboratory.logoReadError'));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!meta) return;
    setSaving(true); setError(null);
    try {
      const patch: LabIdentity = {};
      for (const f of meta.fields) patch[f.id] = values[f.id] ?? '';
      const r = await saveLabIdentity(patch);
      setValues(r.values);
      setSaved(true);
    } catch {
      setError(t('settings.laboratory.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!meta) return <p className="p-4 text-xs text-destructive">{error ?? t('settings.laboratory.loadError')}</p>;

  const logo = values[LOGO_KEY] ?? '';

  return (
    <div className="flex flex-col gap-4 p-4">
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

      <div className="grid grid-cols-[10rem_1fr] items-center gap-x-4 gap-y-3">
        {meta.fields.filter((f) => f.id !== LOGO_KEY).map((f) => (
          f.multiline ? (
            <FieldRow key={f.id} id={f.id} label={t(f.labelKey)} alignTop>
              <Textarea id={f.id} aria-label={t(f.labelKey)} value={values[f.id] ?? ''}
                onChange={(e) => set(f.id, e.target.value)} className="min-h-[64px] text-xs" />
            </FieldRow>
          ) : (
            <FieldRow key={f.id} id={f.id} label={t(f.labelKey)}>
              <Input id={f.id} aria-label={t(f.labelKey)} value={values[f.id] ?? ''}
                onChange={(e) => set(f.id, e.target.value)} className="h-8 text-xs" />
            </FieldRow>
          )
        ))}

        <span className="self-start pt-2 text-xs text-muted-foreground">{t('settings.laboratory.logo')}</span>
        <div className="flex items-center gap-3">
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

      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && !error && <p className="text-xs text-muted-foreground">{t('settings.laboratory.saved')}</p>}

      <div>
        <Button type="button" size="sm" disabled={saving} onClick={() => { void save(); }}>
          {t('settings.laboratory.save')}
        </Button>
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
