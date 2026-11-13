import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/spinner';
import { fetchLabIdentity, saveLabIdentity } from '@/api';

// The keys Settings, Laboratory saves (pages/settings/Laboratory.tsx).
const NAME_KEY = 'lab.name';
const TIMEZONE_KEY = 'lab.timezone';

/** The browser's own time zone, or UTC when it gives none. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The time zones to pick from: the browser's own zone first, then a stored zone the list does not
 * hold, then UTC, then every zone the browser knows. `Intl.supportedValuesOf` does not list UTC, so
 * it is added here. Each zone appears once.
 */
export function timeZoneOptions(stored: string): ComboboxOption[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const zones = [browserTimeZone(), ...(stored ? [stored] : []), 'UTC', ...known];
  return [...new Set(zones)].map((z) => ({ value: z, label: z }));
}

/** Step 1: the laboratory's name and time zone. Save writes both; Skip writes nothing. */
export function LabStep({ onNext }: { onNext: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  // Set when the stored values could not be read. Save then sends a name only if one was typed.
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [stored, setStored] = useState('');
  const [zone, setZone] = useState(browserTimeZone);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Start from what is stored. If that fails, the fields start empty and Save or Skip still work.
  useEffect(() => {
    let cancelled = false;
    fetchLabIdentity().then((r) => {
      if (cancelled) return;
      setName(r.values[NAME_KEY] ?? '');
      const z = (r.values[TIMEZONE_KEY] ?? '').trim();
      if (z) { setStored(z); setZone(z); }
    }, () => { if (!cancelled) setLoadFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const options = useMemo(() => timeZoneOptions(stored), [stored]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    // An empty name after a failed load would overwrite a stored one the person never saw.
    const trimmed = name.trim();
    const values: Record<string, string> = { [TIMEZONE_KEY]: zone };
    if (!loadFailed || trimmed) values[NAME_KEY] = trimmed;
    try {
      await saveLabIdentity(values);
    } catch (err) {
      setMessage(t('firstRun.lab.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
      setSaving(false);
      return;
    }
    onNext();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { void save(e); }} noValidate>
      <h1 className="text-lg font-semibold">{t('firstRun.lab.title')}</h1>
      <p className="text-muted-foreground">{t('firstRun.lab.intro')}</p>
      {loading ? (
        <LoadingState className="min-h-[6rem]" label={t('firstRun.lab.loading')} />
      ) : (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
          <Label htmlFor="first-run-lab-name" className="whitespace-nowrap">{t('firstRun.lab.name')}</Label>
          <Input
            id="first-run-lab-name"
            className="min-w-0"
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Label className="whitespace-nowrap">{t('firstRun.lab.timeZone')}</Label>
          <div className="min-w-0">
            <Combobox
              options={options}
              value={zone}
              onChange={setZone}
              placeholder={t('firstRun.lab.timeZonePick')}
              searchPlaceholder={t('firstRun.lab.timeZoneSearch')}
            />
          </div>
        </div>
      )}
      {message && <p role="alert" className="break-words text-destructive">{message}</p>}
      <Button type="submit" disabled={loading || saving}>{t('firstRun.lab.save')}</Button>
      <Button type="button" variant="ghost" disabled={saving} onClick={onNext}>{t('firstRun.skip')}</Button>
    </form>
  );
}
