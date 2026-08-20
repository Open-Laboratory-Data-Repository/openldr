import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { enUS, fr as frDate, pt as ptDate } from 'date-fns/locale';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Divider } from '@/components/ui/bleed';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DangerConfirmDialog } from '@/terminology/DangerConfirmDialog';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
import { updateVerdict } from '@openldr/core/pure';
import {
  fetchClientConfig, fetchFeatureFlags, setFeatureFlag, runDangerAction,
  fetchNumberSettings, setNumberSetting,
  getValidation, setValidation,
  fetchUpdateState, setUpdateCheckEnabled,
  type ClientConfig, type FeatureFlag, type DangerAction,
  type NumberSetting, type ValidationStrictness, type UpdateState,
} from '@/api';

type PendingDanger = null | 'reset-dashboards' | 'clear-audit' | 'factory-reset';

/** date-fns has no notion of the app language, so "4 minutes ago" comes out English in every
 *  locale unless it is handed one of these. There is no existing resolver in this app — the other
 *  two formatDistanceToNow callers have the same bug — so this is the local, minimal fix. */
const DATE_LOCALES = { en: enUS, fr: frDate, pt: ptDate } as const;

export function General() {
  const { t, i18n } = useTranslation();
  // `resolvedLanguage` can be a region tag ('en-US'); the app only ships the base languages.
  const dateLocale = DATE_LOCALES[(i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2) as keyof typeof DATE_LOCALES] ?? enUS;
  const { hasCapability } = useAuth();
  // Split per-control, matching the server's route-level gates (settings-routes.ts):
  // feature flags, numbers/validation ("general edits"), and the destructive danger-zone
  // actions are three independent capabilities, not one admin flag.
  const canFeatureFlags = hasCapability('settings.feature_flags');
  const canEditGeneral = hasCapability('settings.edit_general');
  const canDangerZone = hasCapability('settings.danger_zone');
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDanger>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [numbers, setNumbers] = useState<NumberSetting[]>([]);
  const [busyNumber, setBusyNumber] = useState<string | null>(null);
  const [validationLevel, setValidationLevel] = useState<ValidationStrictness | null>(null);
  const [pendingValidation, setPendingValidation] = useState<ValidationStrictness | null>(null);
  const [validationBusy, setValidationBusy] = useState(false);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  const load = useCallback(async () => {
    // The update state is loaded on its own so an older server without /api/update
    // (or a network blip) leaves the rest of the About card intact.
    try {
      setUpdate(await fetchUpdateState());
    } catch {
      setUpdate(null);
    }
    try {
      const cfg = await fetchClientConfig();
      setConfig(cfg);
      if (canFeatureFlags) setFlags(await fetchFeatureFlags());
      if (canEditGeneral) {
        setNumbers(await fetchNumberSettings());
        setValidationLevel((await getValidation()).strictness);
      }
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }, [canFeatureFlags, canEditGeneral]);

  const toggleUpdateCheck = useCallback(async (value: boolean) => {
    const prev = update;
    setUpdateBusy(true);
    setUpdate((u) => (u ? { ...u, enabled: value } : u));
    try {
      // The server returns the STORED value; reflect that rather than what was asked for.
      const { enabled } = await setUpdateCheckEnabled(value);
      setUpdate((u) => (u ? { ...u, enabled } : u));
      toast.success(t('settings.general.flags.saved'));
    } catch (e) {
      setUpdate(prev);
      toast.error(t('settings.general.flags.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setUpdateBusy(false);
    }
  }, [update, t]);

  // Derived, not state. `update` is the only input, so recomputing on render is cheaper than
  // keeping a second copy in sync with it.
  const verdict = update ? updateVerdict(update) : null;

  const commitNumber = useCallback(async (setting: NumberSetting) => {
    setBusyNumber(setting.id);
    try {
      const { value } = await setNumberSetting(setting.id, setting.value);
      // The server clamps into range; reflect the stored value.
      setNumbers((prev) => prev.map((s) => (s.id === setting.id ? { ...s, value } : s)));
      toast.success(t('settings.general.numbers.saved'));
    } catch (e) {
      toast.error(t('settings.general.numbers.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
      setNumbers(await fetchNumberSettings());
    } finally {
      setBusyNumber(null);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const onToggle = useCallback(async (flag: FeatureFlag, value: boolean) => {
    setBusyFlag(flag.id);
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, value } : f)));
    try {
      await setFeatureFlag(flag.id, value);
      await fetchClientConfig().then(setConfig);
      toast.success(t('settings.general.flags.saved'));
    } catch (e) {
      setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, value: !value } : f)));
      toast.error(t('settings.general.flags.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusyFlag(null);
    }
  }, [t]);

  const runDanger = useCallback(async (action: DangerAction) => {
    setDangerBusy(true);
    try {
      await runDangerAction(action);
      toast.success(t('settings.general.danger.done', { action }));
      await load();
    } catch (e) {
      toast.error(t('settings.general.danger.failed', { action, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setDangerBusy(false);
      setPending(null);
    }
  }, [t, load]);

  const applyValidation = useCallback(async (level: ValidationStrictness) => {
    setValidationBusy(true);
    try {
      const { strictness } = await setValidation(level);
      setValidationLevel(strictness);
      toast.success(t('settings.general.danger.validation.saved'));
    } catch (e) {
      toast.error(t('settings.general.danger.validation.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setValidationBusy(false);
      setPendingValidation(null);
    }
  }, [t]);

  const dangerMeta: Record<Exclude<PendingDanger, null>, { key: string }> = {
    'reset-dashboards': { key: 'resetDashboards' },
    'clear-audit': { key: 'clearAudit' },
    'factory-reset': { key: 'factoryReset' },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="general-page">
      <div>
        <h1 className="text-lg font-semibold">{t('settings.general.heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.general.description')}</p>
      </div>

      {/* About — all users */}
      <Card>
        <CardHeader><CardTitle>{t('settings.general.about.title')}</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-muted-foreground">{t('settings.general.about.version')}</dt>
            <dd className="font-mono">
              {/* `update.running` is the server's own answer and survives a failed /api/config;
                  falling back to config keeps an older server (no /api/update) working. */}
              {update?.running || config?.version || '—'}
            </dd>
            {/* The whole point of this row: the card used to speak only when an update existed, so
                "current", "check turned off" and "never checked" all rendered as silence. When
                there is no update state at all (older server, or the 500 path) the row is omitted
                rather than showing a dash, which keeps the card exactly as it was. */}
            {verdict && (
              <>
                <dt className="text-muted-foreground">{t('settings.general.about.latest')}</dt>
                <dd className="font-mono" data-testid="update-latest">
                  {verdict.kind === 'update_available' && (
                    <span className="font-sans text-xs text-muted-foreground">
                      {t('settings.general.about.updateAvailable', { version: verdict.latest })}
                      {/* The manifest carries a full ISO timestamp; the operator only needs the day. */}
                      {verdict.releasedAt && ` · ${t('settings.general.about.released', { date: verdict.releasedAt.slice(0, 10) })}`}
                      {verdict.notesUrl && (
                        <a href={verdict.notesUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                          {t('settings.general.about.releaseNotes')}
                        </a>
                      )}
                    </span>
                  )}
                  {verdict.kind === 'up_to_date' && (
                    <>
                      {verdict.latest}
                      <span className="ml-1 font-sans text-xs text-muted-foreground">
                        · {t('settings.general.about.upToDate')}
                      </span>
                    </>
                  )}
                  {/* ⛔ No version number here, and the verdict does not carry one to print. The
                      cache is OLDER than the running version in this state, and an operator read
                      that lower number as an instruction to roll back. "Last checked" below the
                      divider is what conveys the staleness. */}
                  {verdict.kind === 'no_update_found' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.noUpdateFound')}</span>
                  )}
                  {verdict.kind === 'check_off' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.checkOff')}</span>
                  )}
                  {verdict.kind === 'cannot_confirm' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.cannotConfirm')}</span>
                  )}
                  {verdict.kind === 'never_checked' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.notCheckedYet')}</span>
                  )}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('settings.general.about.environment')}</dt>
            <dd className="font-mono">{config?.environment || '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.general.about.license')}</dt>
            <dd>Apache-2.0</dd>
          </dl>

          {/* Nothing here upgrades anything — these are the two commands for the
              operator to run themselves, shown only when there is something to upgrade to. */}
          {verdict?.kind === 'update_available' && (
            <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-2 text-xs text-muted-foreground">{t('settings.general.about.upgradeHow')}</p>
              <pre className="overflow-x-auto font-mono text-xs">docker compose pull{'\n'}docker compose up -d</pre>
            </div>
          )}

          {update && (
            <>
            {/* Separates the static facts above (version, environment, licence) from the update
                check's control and state below. CardContent is `p-4`, so Divider's default
                `-mx-4` lands exactly on the card edges — the edge-to-edge rule in AGENTS.md §5. */}
            <Divider className="my-4" />
            <div className="flex flex-col gap-3">
              {/* Only the SWITCH is gated by settings.edit_general, matching the server's
                  EDIT_GENERAL gate on PUT /api/settings/update (settings-routes.ts). Whether the
                  install is current is not an admin question — everyone sees the state below. */}
              {/* `justify-between`, matching the Feature Flags rows below — the switch belongs
                  hard right, not tucked against its label. A grid of [auto_1fr] left it at the
                  start of the second column, which is what this looked like before. */}
              {canEditGeneral && (
                <div className="flex items-center justify-between gap-4">
                  {/* No htmlFor: Switch renders a <button role="switch">, which a <label> cannot
                      be associated with. The accessible name comes from aria-label instead. */}
                  <Label className="whitespace-nowrap">
                    {t('settings.general.about.checkForUpdates')}
                  </Label>
                  <Switch
                    data-testid="update-check-enabled"
                    checked={update.enabled}
                    disabled={updateBusy}
                    onCheckedChange={(v) => void toggleUpdateCheck(v)}
                    aria-label={t('settings.general.about.checkForUpdates')}
                  />
                </div>
              )}
              <span data-testid="update-last-checked" className="text-xs text-muted-foreground">
                {update.lastCheckedAt
                  ? t('settings.general.about.lastChecked', {
                    when: formatDistanceToNow(new Date(update.lastCheckedAt), { addSuffix: true, locale: dateLocale }),
                  })
                  : t('settings.general.about.neverChecked')}
              </span>
              {/* ⛔ Without this, a check that has failed every day for a year still shows a fresh
                  "Last checked 4 minutes ago" — recordFailure stamps lastCheckedAt on every failed
                  poll (bootstrap/update-check.ts). The operator must be able to tell "no update"
                  from "cannot tell". */}
              {update.lastError && (
                <span data-testid="update-last-error" role="status" className="text-xs text-amber-600 dark:text-amber-500">
                  {t('settings.general.about.checkFailed', { error: update.lastError })}
                </span>
              )}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Feature Flags */}
      {canFeatureFlags && (
      <Card>
        <CardHeader><CardTitle>{t('settings.general.flags.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.flags.description')}</p>
          {flags.map((f) => (
            <div key={f.id} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{t(f.labelKey)}</div>
                <div className="text-xs text-muted-foreground">{t(f.descriptionKey)}</div>
              </div>
              <Switch checked={f.value} disabled={busyFlag === f.id} onCheckedChange={(v) => void onToggle(f, v)} aria-label={t(f.labelKey)} />
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* Limits & tuning — DB-backed number settings migrated from env vars. */}
      {canEditGeneral && numbers.length > 0 && (
      <Card>
        <CardHeader><CardTitle>{t('settings.general.numbers.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.numbers.description')}</p>
          {numbers.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t(s.labelKey)}</div>
                <div className="text-xs text-muted-foreground">{t(s.descriptionKey)}</div>
              </div>
              <Input
                type="number"
                min={s.min}
                max={s.max}
                className="w-40 shrink-0"
                disabled={busyNumber === s.id}
                value={s.value}
                onChange={(e) => setNumbers((prev) => prev.map((x) => (x.id === s.id ? { ...x, value: Number(e.target.value) } : x)))}
                onBlur={() => void commitNumber(s)}
                aria-label={t(s.labelKey)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* Danger Zone. The validation-strictness control is gated by settings.edit_general
          (it's a validation setting, not a destructive action — matches EDIT_GENERAL on the
          server's /api/settings/validation route); the three destructive actions below it
          are gated by settings.danger_zone (server's DANGER_ZONE gate). */}
      {(canEditGeneral || canDangerZone) && (
      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-destructive">{t('settings.general.danger.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.danger.description')}</p>
          {canEditGeneral && validationLevel && (
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{t('settings.general.danger.validation.label')}</div>
                <div className="text-xs text-muted-foreground">{t('settings.general.danger.validation.description')}</div>
              </div>
              <Select
                value={validationLevel}
                disabled={validationBusy}
                onValueChange={(v) => {
                  const level = v as ValidationStrictness;
                  if (level !== validationLevel) setPendingValidation(level);
                }}
              >
                <SelectTrigger className="relative w-32 shrink-0 justify-center border-destructive/50 text-destructive [&>svg]:absolute [&>svg]:right-3" aria-label={t('settings.general.danger.validation.label')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['low', 'medium', 'high'] as const).map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>{t(`settings.general.danger.validation.levels.${lvl}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {canDangerZone && (['reset-dashboards', 'clear-audit', 'factory-reset'] as const).map((action) => {
            const k = dangerMeta[action].key;
            return (
              <div key={action} className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{t(`settings.general.danger.${k}.label`)}</div>
                  <div className="text-xs text-muted-foreground">{t(`settings.general.danger.${k}.description`)}</div>
                </div>
                <Button variant="secondary" className="w-32 shrink-0 border-destructive/50 text-destructive" disabled={dangerBusy} onClick={() => setPending(action)}>
                  {t(`settings.general.danger.${k}.button`)}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      )}

      {canDangerZone && pending && (
        <DangerConfirmDialog
          open={pending !== null}
          onOpenChange={(o) => { if (!o) setPending(null); }}
          title={t(`settings.general.danger.${dangerMeta[pending].key}.title`)}
          confirmName={t(`settings.general.danger.${dangerMeta[pending].key}.confirm`)}
          confirmLabel={t(`settings.general.danger.${dangerMeta[pending].key}.button`)}
          summary={<p>{t(`settings.general.danger.${dangerMeta[pending].key}.warning`)}</p>}
          onConfirm={() => void runDanger(pending)}
        />
      )}

      {canEditGeneral && pendingValidation && validationLevel && (() => {
        // Warn/destructive by DIRECTION of change, not the absolute target level: a
        // low→medium change RAISES strictness even though 'medium' !== 'high'. The dialog
        // is only opened when pending !== current, so these are the two cases.
        const RANK: Record<ValidationStrictness, number> = { low: 0, medium: 1, high: 2 };
        const lowering = RANK[pendingValidation] < RANK[validationLevel];
        return (
        <TypeToConfirmDialog
          open={pendingValidation !== null}
          onOpenChange={(o) => { if (!o) setPendingValidation(null); }}
          title={t('settings.general.danger.validation.dialogTitle', {
            level: t(`settings.general.danger.validation.levels.${pendingValidation}`),
          })}
          body={<p>{t(lowering
            ? 'settings.general.danger.validation.warningLower'
            : 'settings.general.danger.validation.warningRaise')}</p>}
          confirmPhrase={pendingValidation}
          confirmLabel={t('settings.general.danger.validation.apply')}
          cancelLabel={t('settings.general.danger.validation.cancel')}
          destructive={lowering}
          onConfirm={() => void applyValidation(pendingValidation)}
        />
        );
      })()}
    </div>
  );
}
