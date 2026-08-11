import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DesignElement, DesignPage, Margins, Rect, ReportTemplate } from './types';
import { encodeCode128, encodeQr, QR_QUIET_ZONE } from './types';
import { paperSize } from './model';
import { HANDLES, boundingBox, type Handle } from './geometry';
import { useCanvasInteraction } from './useCanvasInteraction';

const GUIDE_COLOR = '#e0369a'; // distinct alignment-guide color, drawn over the white page

/**
 * Resolve `{{lab.*}}` against the install's identity.
 *
 * ⚠ Only `lab.*`. `{{param.x}}` and `{{date}}` stay LITERAL on the canvas, exactly as they are
 * today. The line is deliberate: identity is static install-level data the canvas can simply know,
 * whereas a parameter's value is a run-time choice the canvas has no business guessing. A
 * letterhead you cannot see while positioning it defeats the point of placing it — and an
 * `<img src="{{lab.logo}}">` would otherwise render as a broken-image icon.
 */
function resolveLab(input: string, identity: Record<string, string> | undefined): string {
  if (!input.includes('{{')) return input;
  return input.replace(/\{\{\s*lab\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => identity?.[k] ?? '');
}

interface Props {
  template: ReportTemplate;
  zoom: number;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onCommitRects(rects: Map<string, Rect>): void;
  editingId?: string | null;
  onEditStart?(id: string): void;
  onEditChange?(id: string, text: string): void;
  onEditEnd?(): void;
  /** Lab identity, keyed without the `lab.` prefix — resolves `{{lab.*}}` for the letterhead. */
  identity?: Record<string, string>;
}

export function PageCanvas({ template, zoom, selectedIds, onSelect, onCommitRects,
  editingId = null, onEditStart, onEditChange, onEditEnd, identity }: Props): JSX.Element {
  const { t } = useTranslation();
  const size = paperSize(template.paper, template.orientation);
  return (
    <div data-testid="page-canvas"
      className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto bg-neutral-200 p-6 dark:bg-neutral-800">
      {template.pages.map((page, i) => (
        <div key={page.id} className="flex flex-col items-center gap-1.5">
          <PageSurface page={page} zoom={zoom} pageSize={size} margins={template.margins}
            selectedIds={selectedIds} onSelect={onSelect} onCommitRects={onCommitRects}
            editingId={editingId} onEditStart={onEditStart} onEditChange={onEditChange} onEditEnd={onEditEnd}
            identity={identity} />
          <span className="text-[11px] text-neutral-600 dark:text-neutral-300">
            {t('reportDesigner.pageOf', { n: i + 1, total: template.pages.length })}
          </span>
        </div>
      ))}
    </div>
  );
}

function PageSurface({ page, zoom, pageSize, margins, selectedIds, onSelect, onCommitRects,
  editingId = null, onEditStart, onEditChange, onEditEnd, identity }: {
  page: DesignPage; zoom: number; pageSize: { w: number; h: number }; margins?: Margins;
  selectedIds: string[]; onSelect(ids: string[]): void; onCommitRects(rects: Map<string, Rect>): void;
  editingId?: string | null;
  onEditStart?(id: string): void;
  onEditChange?(id: string, text: string): void;
  onEditEnd?(): void;
  identity?: Record<string, string>;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const ix = useCanvasInteraction({ page, zoom, pageSize, selectedIds, originRef: ref, onSelect, onCommitRects });
  const selectedOnPage = page.elements.filter((el) => selectedIds.includes(el.id));
  const groupBox = selectedOnPage.length > 1
    ? boundingBox(selectedOnPage.map((el) => ix.preview?.get(el.id) ?? el.rect))
    : null;
  return (
    <div ref={ref} data-testid={`page-surface-${page.id}`} onPointerDown={ix.onSurfacePointerDown}
      className="relative bg-white shadow-md ring-1 ring-border" style={{ width: pageSize.w * zoom, height: pageSize.h * zoom }}>
      {page.elements.map((el) => {
        const rect = ix.preview?.get(el.id) ?? el.rect;
        return (
          <ElementBox key={el.id} el={el} rect={rect} zoom={zoom}
            selected={selectedIds.includes(el.id)}
            showHandles={selectedIds.length === 1 && selectedIds[0] === el.id}
            editing={editingId === el.id}
            onPointerDown={(e) => ix.onElementPointerDown(e, el.id)}
            onHandlePointerDown={(e, h) => ix.onHandlePointerDown(e, el.id, h)}
            onDoubleClick={() => onEditStart?.(el.id)}
            onEditChange={(text) => onEditChange?.(el.id, text)}
            onEditEnd={() => onEditEnd?.()}
            identity={identity} />
        );
      })}
      {groupBox && (
        <div aria-hidden data-testid="group-box" className="pointer-events-none absolute outline outline-1 outline-dashed outline-primary"
          style={{ left: groupBox.x * zoom, top: groupBox.y * zoom, width: groupBox.w * zoom, height: groupBox.h * zoom }}>
          {HANDLES.map((h) => (
            <span key={h} data-testid={`group-handle-${h}`} onPointerDown={(e) => ix.onGroupHandlePointerDown(e, h)}
              className={cn('pointer-events-auto absolute h-2 w-2 border border-primary bg-white touch-none', HANDLE_CLASS[h])} />
          ))}
        </div>
      )}
      {ix.guides.map((g, idx) => (
        <span key={idx} aria-hidden data-testid="guide" style={g.axis === 'x'
          ? { position: 'absolute', left: g.pos * zoom, top: g.from * zoom, height: (g.to - g.from) * zoom, width: 1, background: GUIDE_COLOR, pointerEvents: 'none' }
          : { position: 'absolute', top: g.pos * zoom, left: g.from * zoom, width: (g.to - g.from) * zoom, height: 1, background: GUIDE_COLOR, pointerEvents: 'none' }} />
      ))}
      {ix.marquee && (
        <span aria-hidden data-testid="marquee" className="absolute border border-dashed border-primary bg-primary/10 pointer-events-none"
          style={{ left: ix.marquee.x * zoom, top: ix.marquee.y * zoom, width: ix.marquee.w * zoom, height: ix.marquee.h * zoom }} />
      )}
      {margins && (margins.top || margins.right || margins.bottom || margins.left) ? (
        <span aria-hidden data-testid="margin-guide" className="pointer-events-none absolute border border-dashed border-neutral-300"
          style={{ left: margins.left * zoom, top: margins.top * zoom, right: margins.right * zoom, bottom: margins.bottom * zoom }} />
      ) : null}
    </div>
  );
}

const HANDLE_CLASS: Record<Handle, string> = {
  nw: '-left-1 -top-1 cursor-nwse-resize', n: 'left-1/2 -top-1 -translate-x-1/2 cursor-ns-resize',
  ne: '-right-1 -top-1 cursor-nesw-resize', e: '-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize',
  se: '-right-1 -bottom-1 cursor-nwse-resize', s: 'left-1/2 -bottom-1 -translate-x-1/2 cursor-ns-resize',
  sw: '-left-1 -bottom-1 cursor-nesw-resize', w: '-left-1 top-1/2 -translate-y-1/2 cursor-ew-resize',
};

function ElementBox({ el, rect, zoom, selected, showHandles, editing, onPointerDown, onHandlePointerDown, onDoubleClick, onEditChange, onEditEnd, identity }: {
  el: DesignElement; rect: Rect; zoom: number; selected: boolean; showHandles: boolean; editing: boolean;
  onPointerDown(e: ReactPointerEvent): void; onHandlePointerDown(e: ReactPointerEvent, h: Handle): void;
  onDoubleClick(): void; onEditChange(text: string): void; onEditEnd(): void;
  identity?: Record<string, string>;
}): JSX.Element {
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { editRef.current?.focus(); editRef.current?.select(); } }, [editing]);
  const style: CSSProperties = { left: rect.x * zoom, top: rect.y * zoom, width: rect.w * zoom, height: rect.h * zoom };
  const isText = el.kind === 'text' || el.kind === 'datetime';
  return (
    <div role="button" tabIndex={0} aria-label={el.name} data-testid={`el-${el.id}`}
      onPointerDown={editing ? undefined : onPointerDown}
      onDoubleClick={isText ? onDoubleClick : undefined}
      className={cn('absolute touch-none', editing ? 'cursor-text' : 'cursor-move', selected && 'outline outline-2 outline-offset-2 outline-primary')}
      style={style}>
      {editing && isText ? (
        <textarea ref={editRef} data-testid={`edit-${el.id}`} value={el.text ?? ''}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onEditEnd(); } }}
          onBlur={onEditEnd}
          className="absolute inset-0 resize-none overflow-hidden border-0 bg-transparent p-0 leading-tight outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={textStyle(el, zoom)} />
      ) : (
        <ElementContent el={el} zoom={zoom} identity={identity} />
      )}
      {showHandles && !editing && HANDLES.map((h) => (
        <span key={h} data-testid={`handle-${h}`} onPointerDown={(e) => onHandlePointerDown(e, h)}
          className={cn('absolute h-2 w-2 border border-primary bg-white touch-none', HANDLE_CLASS[h])} />
      ))}
    </div>
  );
}

function textStyle(el: DesignElement, zoom: number): CSSProperties {
  const s = el.style ?? {};
  return { fontSize: (s.fontSize ?? 11) * zoom, fontWeight: s.bold ? 600 : 400, textAlign: s.align ?? 'left', color: s.color ?? '#262626' };
}

/**
 * A keyvalue panel as the AUTHOR sees it while editing: its title bar and its pair grid, in the
 * chosen layout.
 *
 * ⚠ Like every other element here, this NEVER resolves the bound query — the canvas has no query
 * runner and adding one would run a query on every drag. A BOUND panel therefore shows each bound
 * column's LABEL with a muted em-dash where its value will be, so the panel's shape is visible while
 * placing it; live values are Preview's job. That is deliberately more than a bound `table` shows
 * here (nothing at all, which reads as a broken binding) and it is the S4 answer to that gap.
 */
function KeyValuePreview({ el, zoom, identity }: { el: DesignElement; zoom: number; identity?: Record<string, string> }): JSX.Element {
  const s = el.style ?? {};
  const title = resolveLab(el.text ?? '', identity).trim();
  const pairs = el.dataSource
    ? (el.boundColumns ?? []).map((c) => ({ label: c.label, value: '—' }))
    : (el.rows ?? []).map((r) => ({ label: r[0] ?? '', value: r[1] ?? '' }));
  const stacked = el.layout === 'stacked';
  const cols = Math.max(1, Math.min(4, el.panelColumns ?? 1));
  return (
    <div className="flex h-full w-full flex-col overflow-hidden"
      style={s.strokeColor ? { border: `${(s.strokeWidth ?? 0.5) * zoom}px solid ${s.strokeColor}` } : undefined}>
      {title && (
        <div className="shrink-0 truncate font-semibold"
          style={{ background: s.fill && s.fill !== 'none' ? s.fill : '#334155', color: s.color ?? '#ffffff',
            fontSize: 8 * zoom, padding: `${3 * zoom}px ${6 * zoom}px` }}>
          {title}
        </div>
      )}
      <div className="grid min-h-0 flex-1 content-start"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: 12 * zoom, padding: `${4 * zoom}px ${6 * zoom}px` }}>
        {pairs.map((p, i) => (
          <div key={i} className={cn('min-w-0', stacked ? 'flex flex-col' : 'flex items-baseline gap-2')}
            style={{ fontSize: 8 * zoom }}>
            <span className={cn('truncate font-semibold text-neutral-500', stacked ? 'uppercase' : 'shrink-0 basis-[40%]')}
              style={stacked ? { fontSize: 6.5 * zoom } : undefined}>{p.label}</span>
            <span className="truncate text-neutral-700">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A barcode or QR drawn REAL, as SVG, from the same encoder the PDF renderer uses
 * (`@openldr/report-designer/pure`) — so what the author places is the geometry that will print,
 * not an icon standing in for it. Width and module density are exactly what placement decisions
 * depend on, and they change with the value's length.
 *
 * ⚠ A BOUND symbol has no value here (the canvas never runs queries), so it encodes the bound
 * column's LABEL as a stand-in and draws it MUTED. Encoding a plausible-looking fake at full
 * strength would put a scannable-but-wrong code on the design surface; muted says "this is the
 * shape, not the code".
 */
function SymbolPreview({ el, identity }: { el: DesignElement; identity?: Record<string, string> }): JSX.Element {
  const bound = !!el.dataSource;
  const value = bound ? (el.boundColumns?.[0]?.label ?? '') : resolveLab(el.text ?? '', identity);
  const opacity = bound ? 0.35 : 1;

  if (el.kind === 'qrcode') {
    const modules = encodeQr(value);
    if (!modules) return <UnencodablePreview />;
    const n = modules.length;
    const span = n + QR_QUIET_ZONE * 2;
    return (
      <svg viewBox={`0 0 ${span} ${span}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" opacity={opacity}>
        {modules.flatMap((row, r) => row.map((dark, c) => (dark
          ? <rect key={`${r}-${c}`} x={c + QR_QUIET_ZONE} y={r + QR_QUIET_ZONE} width={1} height={1} fill="#262626" />
          : null)))}
      </svg>
    );
  }

  const bars = encodeCode128(value);
  if (!bars) return <UnencodablePreview />;
  const caption = el.caption ?? true;
  return (
    <div className="flex h-full w-full flex-col" style={{ opacity }}>
      <svg viewBox={`0 0 ${bars.length} 10`} className="min-h-0 w-full flex-1" preserveAspectRatio="none">
        {bars.map((bar, i) => (bar ? <rect key={i} x={i} y={0} width={1} height={10} fill="#262626" /> : null))}
      </svg>
      {caption && value && (
        <div className="shrink-0 truncate text-center text-[7px] leading-tight text-neutral-800">{value}</div>
      )}
    </div>
  );
}

/** Matches the renderer's dashed placeholder for a value that cannot encode. */
function UnencodablePreview(): JSX.Element {
  return <div className="h-full w-full border border-dashed border-neutral-300" />;
}

function ElementContent({ el, zoom, identity }: { el: DesignElement; zoom: number; identity?: Record<string, string> }): JSX.Element {
  const s = el.style ?? {};
  switch (el.kind) {
    case 'text':
    case 'datetime':
      return (
        <div className="h-full w-full overflow-hidden leading-tight" style={textStyle(el, zoom)}>
          {resolveLab(el.text ?? '', identity)}
        </div>
      );
    case 'line':
      return <div className="w-full" style={{ height: (s.strokeWidth ?? 1) * zoom, background: s.strokeColor ?? '#a3a3a3' }} />;
    case 'rect':
      return <div className="h-full w-full" style={{ border: `${(s.strokeWidth ?? 1) * zoom}px solid ${s.strokeColor ?? '#d4d4d4'}`, background: s.fill && s.fill !== 'none' ? s.fill : 'transparent' }} />;
    case 'image': {
      const src = resolveLab(el.src ?? '', identity);
      return src
        ? <img src={src} alt={el.name} draggable={false} className="h-full w-full object-contain" />
        : (
          <div className="flex h-full w-full items-center justify-center border border-dashed border-neutral-300 text-neutral-400">
            <ImageIcon className="h-4 w-4" />
          </div>
        );
    }
    case 'keyvalue':
      return <KeyValuePreview el={el} zoom={zoom} identity={identity} />;
    case 'barcode':
    case 'qrcode':
      return <SymbolPreview el={el} identity={identity} />;
    case 'table':
      return <TablePreview el={el} />;
  }
}

/** Canvas preview of a table, in three states.
 *
 *  ⚠ A BOUND table's real content lives in `boundColumns` and the resolved query rows; the static
 *  `columns`/`rows` are sample scaffolding from before it was bound. Rendering those made a bound
 *  table look empty (or stale) in the editor while the PDF was fully populated.
 *
 *  ⛔ A TRANSPOSED table leaves `boundColumns` empty ON PURPOSE — its headers are data (the
 *  organisms that cleared the isolate threshold), so they cannot be known without running the
 *  query. The audit's minimum bar ("show its boundColumns headers") is a no-op for exactly the
 *  table it most criticises, the cumulative antibiogram. We show the one header we do know and
 *  mark the rest as data-derived rather than inventing plausible names. */
function TablePreview({ el }: { el: DesignElement }): JSX.Element {
  const { t } = useTranslation();
  const bound = Boolean(el.dataSource);
  const headerCell = 'border border-neutral-300 bg-neutral-100 px-1 py-0.5 text-left font-medium';

  if (bound && el.transpose) {
    return (
      <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
        <thead>
          <tr>
            <th className={headerCell}>{el.transposeLabel ?? ''}</th>
            <th className={cn(headerCell, 'italic text-neutral-400')}>{t('reportDesigner.headersFromData')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={2} className="px-1 py-0.5 italic text-neutral-400">
              {t('reportDesigner.rowsAtRender')}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (bound) {
    const cols = el.boundColumns ?? [];
    // A freshly-bound table (Data tab's pickQuery sets `dataSource` and clears `boundColumns` in the
    // same step — every table passes through this state right after being bound) must not render an
    // empty header row: the PDF renderer (`draw.ts` `tableHeaders`) falls back to the resolved
    // query's own columns when `boundColumns` is empty, so the canvas would show an empty box while
    // the PDF prints a full table. Reuse the transposed branch's marker rather than inventing a
    // second "headers unknown" affordance.
    if (cols.length === 0) {
      return (
        <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
          <thead>
            <tr><th className={cn(headerCell, 'italic text-neutral-400')}>{t('reportDesigner.headersFromData')}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-1 py-0.5 italic text-neutral-400">
                {t('reportDesigner.rowsAtRender')}
              </td>
            </tr>
          </tbody>
        </table>
      );
    }
    return (
      <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
        <thead>
          <tr>{cols.map((c) => (
            <th key={c.key} className={headerCell}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={cols.length} className="px-1 py-0.5 italic text-neutral-400">
              {t('reportDesigner.rowsAtRender')}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
      <thead>
        <tr>{(el.columns ?? []).map((c) => (
          <th key={c} className={headerCell}>{c}</th>
        ))}</tr>
      </thead>
      <tbody>
        {(el.rows ?? []).map((r, ri) => (
          <tr key={ri}>{r.map((cell, ci) => (
            <td key={ci} className="border border-neutral-200 px-1 py-0.5">{cell}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}
