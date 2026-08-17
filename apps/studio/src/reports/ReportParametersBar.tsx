import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { ReportSummary, ReportParamMeta, ReportParamOption } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker, defaultDateRangePresets } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface Props {
  report: ReportSummary;
  params: Record<string, string>;
  options: Record<string, ReportParamOption[]>;
  onChange: (params: Record<string, string>) => void;
  onRun: () => void;
  running: boolean;
  canRun: boolean;
}

const ALL = '__all__';

export function ReportParametersBar({ report, params, options, onChange, onRun, running, canRun }: Props) {
  const { t } = useTranslation();
  const set = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = { ...params };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete next[k];
      else next[k] = v;
    }
    onChange(next);
  };

  const renderControl = (p: ReportParamMeta) => {
    if (p.type === 'daterange') {
      const value = params.from || params.to ? { from: params.from ?? '', to: params.to ?? '' } : null;
      return (
        <DateRangePicker
          value={value}
          onChange={(v) => set({ from: v?.from, to: v?.to })}
          placeholder={p.label}
          // Reports are the surface where this matters most: the date range is usually REQUIRED
          // (Run stays disabled until it is set) and lab data is typically historical, so without
          // presets the only way in is clicking the month arrow once per month.
          presets={defaultDateRangePresets()}
        />
      );
    }
    if (p.type === 'select') {
      const opts = p.optionsKey ? options[p.optionsKey] ?? [] : [];
      return (
        <Select
          value={params[p.id] ?? ALL}
          onValueChange={(v) => set({ [p.id]: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('reports.all')}</SelectItem>
            {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        value={params[p.id] ?? ''}
        onChange={(e) => set({ [p.id]: e.target.value })}
        placeholder={p.label}
        className="h-9 w-40 text-xs"
      />
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
      {report.parameters.map((p) => (
        <div key={p.id} className="flex flex-col gap-1">
          <Label className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {p.label}{p.required && <span className="text-destructive"> *</span>}
            {/* ⛔ Popover, NOT Tooltip. Radix Tooltip ignores touch by design — its
                `onPointerMove` returns early for `pointerType === 'touch'` and its `onPointerDown`
                suppresses the focus path — so on a phone the ⓘ never opens. This help text exists
                to prevent an error the operator hits on exactly that surface (studio is used on
                phones over Tailscale), so it has to open on tap. The trigger is `size-6` = 24px,
                the WCAG 2.2 AA minimum target; `size-4` was 16px. */}
            {p.help && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    aria-label={t('reports.aboutParam', { label: p.label })}
                  >
                    <Info className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-3 text-xs font-normal normal-case tracking-normal">
                  {p.help}
                </PopoverContent>
              </Popover>
            )}
          </Label>
          {renderControl(p)}
        </div>
      ))}
      <Button className="ml-auto h-9" onClick={onRun} disabled={!canRun || running}>
        {running ? t('reports.running') : t('reports.run')}
      </Button>
    </div>
  );
}
