import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { AlignLeft, AlignCenter, AlignRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DesignElement, Margins, Orientation, Paper, Rect, ReportTemplate, TextAlign } from './types';
import { encodeCode128, encodeQr, maxCode128Chars, minWidthPxFor, moduleWidthMm, MIN_MODULE_MM, QR_QUIET_ZONE, ELEMENT_IMAGE_MAX_BYTES, ELEMENT_IMAGE_MIME, validateImageSrc } from './types';
import { findElement, flowTargets, paperSize } from './model';
import { clampRectToPage } from './geometry';
import { ColorField } from './ColorField';
import { SUPPORTED_LANGUAGES } from '@/i18n/language';

export interface PatchOpts { discrete?: boolean }

interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onPatchElement(id: string, patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
  onPatchPage(patch: Partial<ReportTemplate>, opts?: PatchOpts): void;
  onPatchElements(ids: string[], patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
  /** The language being AUTHORED, '' (the default) for the design's own text. Held by the page so
   *  the preview renders the same language the inspector is editing. */
  lang?: string;
  onLangChange?(lang: string): void;
  onSetI18nText?(lang: string, key: string, text: string): void;
}

function common<T>(vals: T[]): T | undefined { return vals.length > 0 && vals.every((v) => v === vals[0]) ? vals[0] : undefined; }

function NumberField({ label, value, onChange, min, placeholder }: { label: string; value: number | undefined; onChange(n: number): void; min?: number; placeholder?: string }): JSX.Element {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { setText(value == null ? '' : String(value)); }, [value]);
  return (
    <div className="flex-1">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <Input type="number" aria-label={label} value={text} min={min} placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) onChange(n); }}
        onBlur={() => {
          const n = Number(text);
          if (text === '' || Number.isNaN(n)) { setText(value == null ? '' : String(value)); return; }
          const clamped = min != null ? Math.max(min, n) : n;
          setText(String(clamped));
          if (clamped !== n) onChange(clamped);
        }}
        className="h-8 text-xs" />
    </div>
  );
}

interface ScanReport {
  /** Modules across the symbol's width, for the value we can see from here. */
  modules: number;
  moduleMm: number;
  tooSmall: boolean;
  minWidthPx: number;
}

/**
 * Whether this symbol is drawn large enough to scan, for the value the DESIGNER can see.
 *
 * `null` for a bound symbol: the real value is whatever the query returns at run time, so there is
 * no honest pass/fail to give — those get the character-budget line instead (see `ScanHint`).
 */
function scanReport(el: DesignElement): ScanReport | null {
  if (el.dataSource) return null;
  const value = el.text ?? '';
  const modules = el.kind === 'qrcode'
    ? (encodeQr(value)?.length ?? 0) + QR_QUIET_ZONE * 2
    : (encodeCode128(value)?.length ?? 0);
  if (!modules) return null;
  // A QR is square: its module pitch is set by the SHORTER side, so measuring width alone would
  // call a 200x20 box comfortable when it is unreadable.
  const across = el.kind === 'qrcode' ? Math.min(el.rect.w, el.rect.h) : el.rect.w;
  const moduleMm = moduleWidthMm(across, modules);
  return { modules, moduleMm, tooSmall: moduleMm < MIN_MODULE_MM, minWidthPx: minWidthPxFor(modules) };
}

/**
 * The authoring-time warning for a symbol too small to scan.
 *
 * This exists because the failure is otherwise INVISIBLE until someone is at a bench with a
 * specimen: a barcode drawn at half the minimum module width still has all its bars, still prints,
 * still passes every test we have, and simply does not read. The designer is the last moment anyone
 * can act on it.
 *
 * It warns and never blocks: `MIN_MODULE_MM` is a practical floor carried from GS1's GS1-128
 * figure, not a conformance rule binding plain Code 128 — and an operator printing to a known
 * high-resolution label printer may legitimately know better than we do.
 */
function ScanHint({ el }: { el: DesignElement }): JSX.Element | null {
  const { t } = useTranslation();
  if (el.dataSource) {
    // Bound: the sample says nothing about the values this will actually carry, so give the budget
    // instead of a pass/fail. No budget line for a bound QR — a QR's capacity is a step function of
    // its version, not a width the author can read a character count off, and a wrong number here
    // would be worse than none.
    if (el.kind === 'qrcode') return null;
    return <p className="text-xs text-muted-foreground">{t('reportDesigner.scanBudget', { count: maxCode128Chars(el.rect.w) })}</p>;
  }
  const report = scanReport(el);
  if (!report) return null;
  if (!report.tooSmall) {
    // ⚠ `min` must be passed even though it is a constant: i18next renders an interpolation token
    // LITERALLY when its value is undefined, so a missing argument ships "{{min}}" to the user
    // rather than failing anywhere a type checker or a test would see it.
    return (
      <p className="text-xs text-muted-foreground">
        {t('reportDesigner.scanOk', { mm: report.moduleMm.toFixed(2), min: MIN_MODULE_MM })}
      </p>
    );
  }
  return (
    <p className="text-xs text-destructive">
      {t('reportDesigner.scanTooSmall', { mm: report.moduleMm.toFixed(2), min: MIN_MODULE_MM, width: report.minWidthPx })}
    </p>
  );
}

/** Image source. Mirrors Settings ▸ Laboratory's logo flow (`pages/settings/Laboratory.tsx`):
 *  choose a file, read it as a data URI, store that. A URL is not offered, because pdfkit reads a
 *  URL source as a file path and the image would silently vanish from the PDF while looking fine
 *  here. A token source (`{{lab.logo}}`) stays editable as text — the built-in designs use one. */
function ImageSource({ el, onPatch }: { el: DesignElement; onPatch: (patch: Partial<DesignElement>) => void }): JSX.Element {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const src = el.src ?? '';
  // Anchored to match `image-src.ts`'s TOKEN regex exactly (including the trim before testing): an
  // unanchored test called `https://x/logo.png?v={{n}}` a valid token, showing it in this editable
  // text field captioned "Resolved at render" while the server rejects it as `not-a-data-uri` — the
  // same defect already fixed once in `image-src.ts`, surviving here at a second site.
  const isToken = /^\{\{[^}]+\}\}$/.test(src.trim());

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!(ELEMENT_IMAGE_MIME as readonly string[]).includes(file.type)) { setError(t('reportDesigner.imageType')); return; }
    if (file.size > ELEMENT_IMAGE_MAX_BYTES) {
      setError(t('reportDesigner.imageTooBig', { max: Math.round(ELEMENT_IMAGE_MAX_BYTES / 1024) })); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      // Checked twice on purpose, not by oversight: the checks above run on the File BEFORE reading
      // it, so a 40 MB pick is refused without being loaded into memory; this one runs on the
      // encoded result, catching a file whose declared type disagrees with its bytes. The server
      // remains authoritative — both of these only save the author a failed round trip.
      const reason = validateImageSrc(value);
      if (reason) { setError(t(reason === 'too-large' ? 'reportDesigner.imageTooBig' : 'reportDesigner.imageType', { max: Math.round(ELEMENT_IMAGE_MAX_BYTES / 1024) })); return; }
      setError(null);
      onPatch({ src: value });
    };
    reader.onerror = () => setError(t('reportDesigner.imageReadError'));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.source')}</div>
      {isToken ? (
        <>
          <Input aria-label={t('reportDesigner.source')} value={src}
            onChange={(e) => onPatch({ src: e.target.value })} className="h-8 text-xs" />
          <div className="text-[10px] text-muted-foreground">{t('reportDesigner.imageToken')}</div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          {src
            ? <img src={src} alt={el.name} className="h-10 w-10 border border-border object-contain" />
            : <div className="flex h-10 w-10 items-center justify-center border border-dashed border-border text-[10px] text-muted-foreground">—</div>}
          <input ref={fileRef} type="file" data-testid="image-file" aria-label={t('reportDesigner.chooseImage')}
            className="hidden" accept={ELEMENT_IMAGE_MIME.join(',')}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              // Reset so picking the SAME file again still fires `change` — without this, choosing
              // logo.png, removing it, and choosing logo.png again is a no-op with no error, and so
              // is retrying after a rejection. Cleared here (not inside onFile) so it runs on every
              // path unconditionally, including both rejection branches.
              e.target.value = '';
            }} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            {t('reportDesigner.chooseImage')}
          </Button>
          {src && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setError(null); onPatch({ src: '' }); }}>
              {t('reportDesigner.removeImage')}
            </Button>
          )}
        </div>
      )}
      {error && <div className="text-[10px] text-destructive">{error}</div>}
    </div>
  );
}

function KindControls({ el, onPatch, lang = '', i18nText, onSetI18nText = () => {} }: {
  el: import('./types').DesignElement;
  onPatch(patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
  lang?: string;
  /** The stored override for `lang`, or undefined when there is none (prints the authored text). */
  i18nText?: string;
  onSetI18nText?(lang: string, key: string, text: string): void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const s = el.style ?? {};
  const style = (patch: Partial<import('./types').ElementStyle>, discrete?: boolean) => onPatch({ style: patch }, discrete ? { discrete: true } : undefined);

  if (el.kind === 'text' || el.kind === 'datetime') {
    const aligns: { v: TextAlign; icon: typeof AlignLeft; label: string }[] = [
      { v: 'left', icon: AlignLeft, label: t('reportDesigner.alignLeft') },
      { v: 'center', icon: AlignCenter, label: t('reportDesigner.alignCenter') },
      { v: 'right', icon: AlignRight, label: t('reportDesigner.alignRight') },
    ];
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.content')}</div>
          {/* With a language selected this edits that language's OVERRIDE, and the authored text
              becomes the placeholder — so an empty box means "prints the authored text", which is
              exactly what the renderer does with a missing entry. */}
          {lang
            ? <Textarea aria-label={t('reportDesigner.content')} value={i18nText ?? ''} placeholder={el.text ?? ''}
                onChange={(e) => onSetI18nText(lang, el.id, e.target.value)} className="min-h-[44px] text-xs" />
            : <Textarea aria-label={t('reportDesigner.content')} value={el.text ?? ''}
                onChange={(e) => onPatch({ text: e.target.value })} className="min-h-[44px] text-xs" />}
        </div>
        <div className="flex items-end gap-2">
          <NumberField label={t('reportDesigner.fontSize')} value={s.fontSize ?? 11} onChange={(n) => style({ fontSize: n })} min={4} />
          <Button type="button" variant={s.bold ? 'default' : 'outline'} size="icon" className="h-8 w-8 font-bold"
            aria-label={t('reportDesigner.bold')} aria-pressed={!!s.bold} onClick={() => style({ bold: !s.bold }, true)}>B</Button>
          <div className="flex h-8 rounded-md border border-border">
            {aligns.map(({ v, icon: Icon, label }) => (
              <button key={v} type="button" aria-label={label} aria-pressed={(s.align ?? 'left') === v} onClick={() => style({ align: v }, true)}
                className={cn('flex w-8 items-center justify-center first:rounded-l-md last:rounded-r-md',
                  (s.align ?? 'left') === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.color')}</div>
          <ColorField value={s.color ?? '#000000'} onChange={(c, opts) => style({ color: c }, !!opts?.discrete)} aria-label={t('reportDesigner.color')} />
        </div>
      </div>
    );
  }

  if (el.kind === 'line' || el.kind === 'rect') {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.strokeColor')}</div>
          <ColorField value={s.strokeColor ?? '#9ca3af'} onChange={(c, opts) => style({ strokeColor: c }, !!opts?.discrete)} aria-label={t('reportDesigner.strokeColor')} />
        </div>
        <NumberField label={t('reportDesigner.strokeWidth')} value={s.strokeWidth ?? 1} onChange={(n) => style({ strokeWidth: n })} min={1} />
        {el.kind === 'rect' && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.fill')}</div>
            <ColorField value={s.fill ?? 'none'} onChange={(c, opts) => style({ fill: c }, !!opts?.discrete)} allowNone aria-label={t('reportDesigner.fill')} />
          </div>
        )}
      </div>
    );
  }

  if (el.kind === 'image') {
    // Keyed on el.id so switching elements REMOUNTS this: the local error state from a rejected
    // pick would otherwise survive the selection change and appear on an unrelated element.
    return <ImageSource key={el.id} el={el} onPatch={onPatch} />;
  }

  if (el.kind === 'barcode' || el.kind === 'qrcode') {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.symbolValue')}</div>
          {/* When bound, the disabled input shows WHICH field is encoded rather than repeating the
              helper line verbatim underneath it — the author already knows it is bound (the input
              is disabled and the line says so); what they cannot see otherwise is the field. */}
          <Input aria-label={t('reportDesigner.symbolValue')} disabled={!!el.dataSource}
            value={el.dataSource ? (el.boundColumns?.[0]?.label ?? el.boundColumns?.[0]?.key ?? '') : (el.text ?? '')}
            placeholder={el.dataSource ? '—' : '{{param.request}}'}
            onChange={(e) => onPatch({ text: e.target.value })} className="h-8 text-xs" />
          <p className="mt-1 text-xs text-muted-foreground">
            {el.dataSource ? t('reportDesigner.symbolBound') : t('reportDesigner.symbolStaticHint')}
          </p>
        </div>
        {el.kind === 'barcode' && (
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox aria-label={t('reportDesigner.barcodeCaption')} checked={el.caption ?? true}
              onCheckedChange={(v) => onPatch({ caption: v === true }, { discrete: true })} />
            {t('reportDesigner.barcodeCaption')}
          </label>
        )}
        <ScanHint el={el} />
        {el.kind === 'barcode' && (
          <Button type="button" variant="outline" size="sm" className="justify-start text-xs"
            onClick={() => {
              // Widen in place, keeping the left edge — the author put the element where they want
              // it, so growing rightward is the least surprising fix.
              const need = scanReport(el)?.minWidthPx;
              if (need) onPatch({ rect: { ...el.rect, w: need } }, { discrete: true });
            }}
            disabled={!scanReport(el)?.tooSmall}>
            {t('reportDesigner.scanFixWidth')}
          </Button>
        )}
      </div>
    );
  }

  if (el.kind === 'keyvalue') {
    // No static-pair editor: an unbound panel shows its sample pairs and is made real by binding a
    // query in the Data tab — the same contract a table's sample `rows` already have here.
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.panelTitle')}</div>
          <Input aria-label={t('reportDesigner.panelTitle')} value={el.text ?? ''} placeholder="—"
            onChange={(e) => onPatch({ text: e.target.value })} className="h-8 text-xs" />
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.panelTitleFill')}</div>
          <ColorField value={s.fill ?? '#334155'} onChange={(c, opts) => style({ fill: c }, !!opts?.discrete)} aria-label={t('reportDesigner.panelTitleFill')} />
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.layout')}</div>
          <Select value={el.layout ?? 'inline'} onValueChange={(v) => onPatch({ layout: v as 'inline' | 'stacked' | 'stat' }, { discrete: true })}>
            <SelectTrigger aria-label={t('reportDesigner.layout')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inline">{t('reportDesigner.layoutInline')}</SelectItem>
              <SelectItem value="stacked">{t('reportDesigner.layoutStacked')}</SelectItem>
              <SelectItem value="stat">{t('reportDesigner.layoutStat')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <NumberField label={t('reportDesigner.panelColumns')} value={el.panelColumns ?? 1}
          onChange={(n) => onPatch({ panelColumns: Math.max(1, Math.min(4, Math.round(n))) })} min={1} />
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.strokeColor')}</div>
          <ColorField value={s.strokeColor ?? 'none'} allowNone
            onChange={(c, opts) => style({ strokeColor: c === 'none' ? undefined : c }, !!opts?.discrete)}
            aria-label={t('reportDesigner.strokeColor')} />
        </div>
      </div>
    );
  }

  if (el.kind === 'table') {
    // Turning transpose ON clears boundColumns in the SAME patch: a transposed table's headers are
    // data (the schema refuses authored ones), and a two-step clear would leave a saveable design
    // in the refused state between the steps.
    const transposeBlock = (
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox aria-label={t('reportDesigner.transpose')} checked={el.transpose ?? false}
            onCheckedChange={(v) => onPatch(v === true
              ? { transpose: true, boundColumns: undefined }
              : { transpose: undefined, transposeLabel: undefined }, { discrete: true })} />
          {t('reportDesigner.transpose')}
        </label>
        {el.transpose && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.transposeLabel')}</div>
            <Input aria-label={t('reportDesigner.transposeLabel')} value={el.transposeLabel ?? ''}
              onChange={(e) => onPatch({ transposeLabel: e.target.value })} className="h-8 text-xs" />
          </div>
        )}
      </div>
    );
    // Bound tables get their columns from the Data tab's boundColumns — no PropertiesTab columns editor.
    if (el.dataSource) return transposeBlock;
    const cols = el.columns ?? [];
    const setCols = (next: string[], discrete?: boolean) => onPatch({ columns: next }, discrete ? { discrete: true } : undefined);
    return (
      <div className="flex flex-col gap-3">
        {transposeBlock}
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.columns')}</div>
          <div className="flex flex-col gap-1">
            {cols.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input aria-label={`Column ${i + 1}`} value={c} onChange={(e) => setCols(cols.map((x, j) => (j === i ? e.target.value : x)))} className="h-7 text-xs" />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  aria-label={`${t('reportDesigner.removeColumn')} ${i + 1}`} onClick={() => setCols(cols.filter((_, j) => j !== i), true)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-start"
              onClick={() => setCols([...cols, `Column ${cols.length + 1}`], true)}>{t('reportDesigner.addColumn')}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (el.kind === 'cellgrid') {
    const cells = el.cellColumns ?? [];
    const trailing = el.trailingColumns ?? [];
    const setCells = (next: string[], discrete?: boolean) => onPatch({ cellColumns: next }, discrete ? { discrete: true } : undefined);
    // An empty list deletes the key: `trailingColumns: []` and "no trailing columns" mean the same
    // thing to the renderer, and the design should persist the shorter spelling.
    const setTrailing = (next: typeof trailing, discrete?: boolean) =>
      onPatch({ trailingColumns: next.length ? next : undefined }, discrete ? { discrete: true } : undefined);
    const nextCellKey = () => { let n = 1; const has = new Set(cells); while (has.has(`c${n}`)) n += 1; return `c${n}`; };
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.labelColumn')}</div>
          <Input aria-label={t('reportDesigner.labelColumn')} value={el.labelColumn ?? ''} placeholder="—"
            onChange={(e) => onPatch({ labelColumn: e.target.value || undefined })} className="h-8 text-xs" />
          <p className="mt-1 text-xs text-muted-foreground">{t('reportDesigner.labelColumnHint')}</p>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.cellColumns')}</div>
          <div className="flex flex-col gap-1">
            {cells.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input aria-label={`${t('reportDesigner.cellColumns')} ${i + 1}`} value={c}
                  onChange={(e) => setCells(cells.map((x, j) => (j === i ? e.target.value : x)))} className="h-7 text-xs" />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  aria-label={`${t('reportDesigner.removeColumn')} ${i + 1}`} onClick={() => setCells(cells.filter((_, j) => j !== i), true)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-start"
              onClick={() => setCells([...cells, nextCellKey()], true)}>{t('reportDesigner.addCellColumn')}</Button>
          </div>
        </div>
        <NumberField label={t('reportDesigner.paletteSteps')} value={el.palette?.steps ?? 1}
          onChange={(n) => onPatch({ palette: { ramp: el.palette?.ramp ?? 'blue', steps: Math.max(1, Math.min(5, Math.round(n))) } })} min={1} />
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox aria-label={t('reportDesigner.groupBoundary')} checked={el.groupBoundary === 'token-change'}
            onCheckedChange={(v) => onPatch({ groupBoundary: v === true ? 'token-change' : undefined }, { discrete: true })} />
          {t('reportDesigner.groupBoundary')}
        </label>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.trailingColumns')}</div>
          <div className="flex flex-col gap-1">
            {trailing.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input aria-label={`${t('reportDesigner.trailingKey')} ${i + 1}`} value={c.key} placeholder={t('reportDesigner.trailingKey')}
                  onChange={(e) => setTrailing(trailing.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="h-7 w-20 text-xs" />
                <Input aria-label={`${t('reportDesigner.trailingLabel')} ${i + 1}`} value={c.label} placeholder={t('reportDesigner.trailingLabel')}
                  onChange={(e) => setTrailing(trailing.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-7 flex-1 text-xs" />
                <Input type="number" aria-label={`${t('reportDesigner.trailingWidth')} ${i + 1}`} value={c.width}
                  onChange={(e) => { const n = Number(e.target.value); if (n > 0) setTrailing(trailing.map((x, j) => (j === i ? { ...x, width: n } : x))); }}
                  className="h-7 w-16 text-xs" />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  aria-label={`${t('reportDesigner.removeColumn')} trailing ${i + 1}`} onClick={() => setTrailing(trailing.filter((_, j) => j !== i), true)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-start"
              onClick={() => setTrailing([...trailing, { key: '', label: '', width: 20 }], true)}>{t('reportDesigner.addTrailingColumn')}</Button>
          </div>
          {/* Every other length on this pane is px@96; trailing widths are POINTS by schema. Silence
              here would re-run the units trap that once shipped a clipped row. */}
          <p className="mt-1 text-xs text-muted-foreground">{t('reportDesigner.trailingWidthHint')}</p>
        </div>
      </div>
    );
  }

  if (el.kind === 'chart') {
    const values = el.valueColumns ?? [];
    const setValues = (next: string[], discrete?: boolean) =>
      onPatch({ valueColumns: next.length ? next : undefined }, discrete ? { discrete: true } : undefined);
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.chartType')}</div>
          <Select value={el.chartType ?? 'bar'} onValueChange={(v) => onPatch({ chartType: v as 'bar' | 'line' | 'donut' }, { discrete: true })}>
            <SelectTrigger aria-label={t('reportDesigner.chartType')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bar">{t('reportDesigner.chartBar')}</SelectItem>
              <SelectItem value="line">{t('reportDesigner.chartLine')}</SelectItem>
              <SelectItem value="donut">{t('reportDesigner.chartDonut')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.labelColumn')}</div>
          <Input aria-label={t('reportDesigner.labelColumn')} value={el.labelColumn ?? ''} placeholder="—"
            onChange={(e) => onPatch({ labelColumn: e.target.value || undefined })} className="h-8 text-xs" />
          <p className="mt-1 text-xs text-muted-foreground">{t('reportDesigner.chartLabelHint')}</p>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.valueColumns')}</div>
          <div className="flex flex-col gap-1">
            {values.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input aria-label={`${t('reportDesigner.valueColumns')} ${i + 1}`} value={c}
                  onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))} className="h-7 text-xs" />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  aria-label={`${t('reportDesigner.removeColumn')} value ${i + 1}`} onClick={() => setValues(values.filter((_, j) => j !== i), true)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-start"
              onClick={() => setValues([...values, ''], true)}>{t('reportDesigner.addValueColumn')}</Button>
          </div>
          {el.chartType === 'donut' && <p className="mt-1 text-xs text-muted-foreground">{t('reportDesigner.donutFirstOnly')}</p>}
        </div>
      </div>
    );
  }

  return null;
}

// Radix Select refuses value="", so "not set" travels as this sentinel (DataTab's NONE convention).
const NONE_FLOW = '__none__';

/** The Flow section: plain-word controls over the schema's pagination fields (`flowAfter`,
 *  `flowGap`, `showOn`, `showWithTable`, `fillTo`). The renderer THROWS on a `flowAfter` cycle, so
 *  the Place-below options come from `flowTargets`, which cannot offer one. */
function FlowSection({ template, el, onPatch }: {
  template: ReportTemplate; el: DesignElement;
  onPatch(patch: Partial<DesignElement>, opts?: PatchOpts): void;
}): JSX.Element {
  const { t } = useTranslation();
  const page = template.pages.find((p) => p.elements.some((e) => e.id === el.id));
  const siblings = page?.elements ?? [];
  const targets = flowTargets(siblings, el.id);
  const anchors = siblings.filter((e) => e.id !== el.id && (e.kind === 'table' || e.kind === 'cellgrid'));
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.flow')}</div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.placeBelow')}</div>
        <Select value={el.flowAfter ?? NONE_FLOW}
          onValueChange={(v) => onPatch(v === NONE_FLOW ? { flowAfter: undefined, flowGap: undefined } : { flowAfter: v }, { discrete: true })}>
          <SelectTrigger aria-label={t('reportDesigner.placeBelow')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_FLOW}>{t('reportDesigner.none')}</SelectItem>
            {targets.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {el.flowAfter && (
        <NumberField label={t('reportDesigner.flowGap')} value={el.flowGap ?? 0}
          onChange={(n) => onPatch({ flowGap: Math.max(0, n) })} min={0} />
      )}
      <label className="flex items-center gap-2 text-xs text-foreground">
        <Checkbox aria-label={t('reportDesigner.firstPageOnly')} checked={el.showOn === 'first-chunk'}
          onCheckedChange={(v) => onPatch({ showOn: v === true ? 'first-chunk' : undefined }, { discrete: true })} />
        {t('reportDesigner.firstPageOnly')}
      </label>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.showWith')}</div>
        <Select value={el.showWithTable ?? NONE_FLOW}
          onValueChange={(v) => onPatch({ showWithTable: v === NONE_FLOW ? undefined : v }, { discrete: true })}>
          <SelectTrigger aria-label={t('reportDesigner.showWith')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_FLOW}>{t('reportDesigner.none')}</SelectItem>
            {anchors.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {el.kind === 'cellgrid' && (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox aria-label={t('reportDesigner.fillToBottom')} checked={el.fillTo === 'rect-bottom'}
            onCheckedChange={(v) => onPatch({ fillTo: v === true ? 'rect-bottom' : undefined }, { discrete: true })} />
          {t('reportDesigner.fillToBottom')}
        </label>
      )}
    </div>
  );
}

function BulkControls({ ids, els, onPatchElements }: {
  ids: string[]; els: import('./types').DesignElement[];
  onPatchElements(ids: string[], patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const style = (patch: Partial<import('./types').ElementStyle>, discrete?: boolean) => onPatchElements(ids, { style: patch }, discrete ? { discrete: true } : undefined);
  const styles = els.map((e) => e.style ?? {});
  const allText = els.every((e) => e.kind === 'text' || e.kind === 'datetime');
  const allShape = els.every((e) => e.kind === 'line' || e.kind === 'rect');
  const allRect = els.every((e) => e.kind === 'rect');
  if (!allText && !allShape) return null;

  if (allText) {
    const align = common(styles.map((s) => s.align ?? 'left'));
    const bold = common(styles.map((s) => !!s.bold));
    const size = common(styles.map((s) => s.fontSize ?? 11));
    const color = common(styles.map((s) => s.color ?? '#000000'));
    const aligns: { v: TextAlign; icon: typeof AlignLeft; label: string }[] = [
      { v: 'left', icon: AlignLeft, label: t('reportDesigner.alignLeft') },
      { v: 'center', icon: AlignCenter, label: t('reportDesigner.alignCenter') },
      { v: 'right', icon: AlignRight, label: t('reportDesigner.alignRight') },
    ];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <NumberField label={t('reportDesigner.fontSize')} value={size} onChange={(n) => style({ fontSize: n })} min={4} placeholder={t('reportDesigner.mixed')} />
          <Button type="button" variant={bold ? 'default' : 'outline'} size="icon" className="h-8 w-8 font-bold"
            aria-label={t('reportDesigner.bold')} aria-pressed={!!bold} onClick={() => style({ bold: !bold }, true)}>B</Button>
          <div className="flex h-8 rounded-md border border-border">
            {aligns.map(({ v, icon: Icon, label }) => (
              <button key={v} type="button" aria-label={label} aria-pressed={align === v} onClick={() => style({ align: v }, true)}
                className={cn('flex w-8 items-center justify-center first:rounded-l-md last:rounded-r-md',
                  align === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.color')}</div>
          <ColorField value={color ?? '#000000'} mixed={color === undefined} onChange={(c, opts) => style({ color: c }, !!opts?.discrete)} aria-label={t('reportDesigner.color')} />
        </div>
      </div>
    );
  }
  // allShape
  const strokeColor = common(styles.map((s) => s.strokeColor ?? '#9ca3af'));
  const strokeWidth = common(styles.map((s) => s.strokeWidth ?? 1));
  const fill = common(styles.map((s) => s.fill ?? 'none'));
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.strokeColor')}</div>
        <ColorField value={strokeColor ?? '#9ca3af'} mixed={strokeColor === undefined} onChange={(c, opts) => style({ strokeColor: c }, !!opts?.discrete)} aria-label={t('reportDesigner.strokeColor')} />
      </div>
      <NumberField label={t('reportDesigner.strokeWidth')} value={strokeWidth} onChange={(n) => style({ strokeWidth: n })} min={1} placeholder={t('reportDesigner.mixed')} />
      {allRect && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.fill')}</div>
          <ColorField value={fill ?? 'none'} mixed={fill === undefined} onChange={(c, opts) => style({ fill: c }, !!opts?.discrete)} allowNone aria-label={t('reportDesigner.fill')} />
        </div>
      )}
    </div>
  );
}

/** The language being authored, above everything else in the tab.
 *
 *  "Design text" is the authored language, not a fourth language: it edits `el.text`, which is
 *  what prints when a run asks for a language this design has no entry for. Picking fr or pt
 *  switches the content field to that language's override map and previews in it. */
function LanguageBar({ lang, onLangChange }: { lang: string; onLangChange(l: string): void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="border-b border-border p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.printLanguage')}</div>
      <Select value={lang === '' ? '_source' : lang} onValueChange={(v) => onLangChange(v === '_source' ? '' : v)}>
        <SelectTrigger className="h-8 w-full text-xs" aria-label={t('reportDesigner.printLanguage')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_source">{t('reportDesigner.designText')}</SelectItem>
          {/* Every language, English included: a design authored in French needs an English
              override just as much, and the authored text is a SOURCE, not a language. */}
          {SUPPORTED_LANGUAGES.map((l) => (
            <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function PropertiesTab(props: Props): JSX.Element {
  return (
    <>
      <LanguageBar lang={props.lang ?? ''} onLangChange={props.onLangChange ?? (() => {})} />
      <PropertiesBody {...props} />
    </>
  );
}

function PropertiesBody({ template, selectedIds, onPatchElement, onPatchPage, onPatchElements, lang = '', onSetI18nText }: Props): JSX.Element {
  const { t } = useTranslation();
  const selected = selectedIds.length === 1 ? findElement(template, selectedIds[0]) : null;
  const size = paperSize(template.paper, template.orientation);

  if (selectedIds.length > 1) {
    const els = selectedIds.map((id) => findElement(template, id)).filter((e): e is import('./types').DesignElement => !!e);
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.selectedCount', { count: selectedIds.length })}</div>
        <BulkControls ids={selectedIds} els={els} onPatchElements={onPatchElements} />
      </div>
    );
  }

  if (!selected) {
    const m: Margins = template.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const setMargin = (patch: Partial<Margins>) => onPatchPage({ margins: { ...m, ...patch } });
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.pageSettings')}</div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.paper')}</div>
          <Select value={template.paper} onValueChange={(v) => onPatchPage({ paper: v as Paper }, { discrete: true })}>
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="Letter">Letter</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.orientation')}</div>
          <Select value={template.orientation} onValueChange={(v) => onPatchPage({ orientation: v as Orientation }, { discrete: true })}>
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="portrait">portrait</SelectItem><SelectItem value="landscape">landscape</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.margins')}</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Margin top" value={m.top} onChange={(top) => setMargin({ top })} min={0} />
            <NumberField label="Margin right" value={m.right} onChange={(right) => setMargin({ right })} min={0} />
            <NumberField label="Margin bottom" value={m.bottom} onChange={(bottom) => setMargin({ bottom })} min={0} />
            <NumberField label="Margin left" value={m.left} onChange={(left) => setMargin({ left })} min={0} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox aria-label={t('reportDesigner.pageNumbers')} checked={template.pageNumbers ?? false}
            onCheckedChange={(v) => onPatchPage({ pageNumbers: v === true }, { discrete: true })} />
          {t('reportDesigner.pageNumbers')}
        </label>
      </div>
    );
  }

  const setRect = (patch: Partial<Rect>) => onPatchElement(selected.id, { rect: clampRectToPage({ ...selected.rect, ...patch }, size) });
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t('reportDesigner.elementLabel')} · {t(`reportDesigner.element.${selected.kind}`)}
      </div>
      <KindControls el={selected} onPatch={(patch, opts) => onPatchElement(selected.id, patch, opts)}
        lang={lang} i18nText={lang ? template.i18n?.[lang]?.[selected.id] : undefined} onSetI18nText={onSetI18nText} />
      <FlowSection template={template} el={selected} onPatch={(patch, opts) => onPatchElement(selected.id, patch, opts)} />
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.positionSize')}</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={selected.rect.x} onChange={(x) => setRect({ x })} />
          <NumberField label="Y" value={selected.rect.y} onChange={(y) => setRect({ y })} />
          <NumberField label="W" value={selected.rect.w} onChange={(w) => setRect({ w })} min={8} />
          <NumberField label="H" value={selected.rect.h} onChange={(h) => setRect({ h })} min={8} />
        </div>
      </div>
    </div>
  );
}
