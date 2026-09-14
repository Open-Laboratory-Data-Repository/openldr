import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createSchedule, updateSchedule, type ReportSchedule, type ReportParamMeta, type ScheduleInput, type ReportParamOption } from '../api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ALL = '__all__';
const WEEKDAYS: { value: string; key: string }[] = [
  { value: '1', key: 'Mon' }, { value: '2', key: 'Tue' }, { value: '3', key: 'Wed' },
  { value: '4', key: 'Thu' }, { value: '5', key: 'Fri' }, { value: '6', key: 'Sat' }, { value: '0', key: 'Sun' },
];

interface Props {
  open: boolean;
  reportId: string;
  parameters: ReportParamMeta[];
  options: Record<string, ReportParamOption[]>;
  initialParams: Record<string, string>;
  existing?: ReportSchedule;
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleDialog({ open, reportId, parameters, options, initialParams, existing, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [frequency, setFrequency] = useState<ScheduleInput['frequency']>(existing?.frequency ?? 'monthly');
  const [dayOfWeek, setDayOfWeek] = useState(String(existing?.dayOfWeek ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(existing?.dayOfMonth ?? 1));
  const [outputFormat, setOutputFormat] = useState<ScheduleInput['outputFormat']>(
    existing?.outputFormat ?? 'xlsx',
  );
  // Seed from the schedule's own params (edit) or the page's current params (new), but
  // drop the daterange-derived `from`/`to` — a schedule's date window is auto-computed
  // per period at run time, so storing a fixed window would be stale/misleading.
  const [params, setParams] = useState<Record<string, string>>(() => {
    const { from: _f, to: _t, ...rest } = existing?.params ?? initialParams ?? {};
    return rest;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const paramFields = parameters.filter((p) => p.type !== 'daterange');
  const setParam = (id: string, v: string | undefined) => {
    setParams((prev) => {
      const next = { ...prev };
      if (v === undefined || v === '') delete next[id];
      else next[id] = v;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    const body: ScheduleInput = {
      frequency,
      dayOfWeek: frequency === 'weekly' ? Number(dayOfWeek) : null,
      dayOfMonth: frequency === 'monthly' ? Number(dayOfMonth) : null,
      outputFormat,
      params,
    };
    try {
      if (existing) await updateSchedule(existing.id, body);
      else await createSchedule(reportId, body);
      toast.success(t('reports.scheduling.saved'));
      onSaved();
      onClose();
    } catch {
      setError(t('reports.scheduling.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle>{existing ? t('reports.scheduling.edit') : t('reports.scheduling.new')}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('common.actions')}><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={saving} onSelect={() => void handleSave()}>{t('reports.scheduling.save')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription className="sr-only">{t('reports.scheduling.dateWindowAuto')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 [&>label]:max-w-28 [&>label]:break-words">
            <Label htmlFor="schedule-frequency">{t('reports.scheduling.frequency')}</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleInput['frequency'])}>
              <SelectTrigger id="schedule-frequency" className="h-9 min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t('reports.scheduling.daily')}</SelectItem>
                <SelectItem value="weekly">{t('reports.scheduling.weekly')}</SelectItem>
                <SelectItem value="monthly">{t('reports.scheduling.monthly')}</SelectItem>
                <SelectItem value="quarterly">{t('reports.scheduling.quarterly')}</SelectItem>
              </SelectContent>
            </Select>

          {frequency === 'weekly' && (
            <>
              <Label htmlFor="schedule-weekday">{t('reports.scheduling.dayOfWeek')}</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger id="schedule-weekday" className="h-9 min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.key}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}

          {frequency === 'monthly' && (
            <>
              <Label htmlFor="schedule-monthday">{t('reports.scheduling.dayOfMonth')}</Label>
              <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                <SelectTrigger id="schedule-monthday" className="h-9 min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}

            <Label htmlFor="schedule-format">{t('reports.scheduling.outputFormat')}</Label>
            <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as ScheduleInput['outputFormat'])}>
              <SelectTrigger id="schedule-format" className="h-9 min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xlsx">XLSX</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>

          {paramFields.map((p) => (
            <Fragment key={p.id}>
              <Label htmlFor={`schedule-param-${p.id}`}>{p.label}</Label>
              {p.type === 'select' ? (
                <Select
                  value={params[p.id] ?? ALL}
                  onValueChange={(v) => setParam(p.id, v === ALL ? undefined : v)}
                >
                  <SelectTrigger id={`schedule-param-${p.id}`} className="h-9 min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('reports.all')}</SelectItem>
                    {(p.optionsKey ? options[p.optionsKey] ?? [] : []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input id={`schedule-param-${p.id}`} className="h-9 min-w-0" value={params[p.id] ?? ''} onChange={(e) => setParam(p.id, e.target.value)} placeholder={p.label} />
              )}
            </Fragment>
          ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{t('reports.scheduling.dateWindowAuto')}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

      </SheetContent>
    </Sheet>
  );
}
