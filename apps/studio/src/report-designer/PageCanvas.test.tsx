import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PageCanvas } from './PageCanvas';
import { MOCK_TEMPLATES } from './mockTemplates';
import type { DesignElement, ReportTemplate } from './types';

function pd(el: Element, x: number, y: number, extra: object = {}) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, ...extra });
}

describe('PageCanvas', () => {
  it('renders every element and the table columns', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Resistance table' })).toBeInTheDocument();
    expect(screen.getByText('Organism')).toBeInTheDocument();
  });

  it('selects an element on pointer-down and clears on empty surface', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={[]} onSelect={onSelect} onCommitRects={vi.fn()} />);
    pd(screen.getByTestId('el-amr-table'), 10, 10);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    expect(onSelect).toHaveBeenCalledWith(['amr-table']);
    pd(screen.getByTestId('page-surface-rt-amr-summary-p1'), 5, 5);
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it('shift pointer-down extends the selection', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']} onSelect={onSelect} onCommitRects={vi.fn()} />);
    pd(screen.getByTestId('el-amr-table'), 10, 10, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title', 'amr-table']);
  });

  it('draws eight handles on a single selected element', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    const el = screen.getByTestId('el-amr-table');
    ['nw','n','ne','e','se','s','sw','w'].forEach((h) => expect(el.querySelector(`[data-testid="handle-${h}"]`)).toBeTruthy());
  });

  it('shows no handles and outlines every element when multiple are selected', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-title', 'amr-table']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByTestId('el-amr-title').className).toContain('outline');
    expect(screen.getByTestId('el-amr-table').className).toContain('outline');
    expect(screen.queryByTestId('handle-nw')).toBeNull();
  });

  it('shift-click removes an already-selected element', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-title', 'amr-table']} onSelect={onSelect} onCommitRects={vi.fn()} />);
    pd(screen.getByTestId('el-amr-table'), 10, 10, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title']);
  });
});

describe('PageCanvas interaction', () => {
  it('commits a drag as a rect change', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const el = screen.getByTestId('el-amr-table');
    pd(el, 100, 100);
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window, { clientX: 140, clientY: 130 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rects = onCommit.mock.calls[0][0] as Map<string, { x: number; y: number }>;
    expect(rects.get('amr-table')).toBeTruthy();
  });

  it('a plain click (no move) does not commit', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const el = screen.getByTestId('el-amr-table');
    pd(el, 100, 100);
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('resizes from a handle', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const handle = within(screen.getByTestId('el-amr-table')).getByTestId('handle-se');
    pd(handle, 0, 0);
    fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 30 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('marquee-drag selects the intersecting elements', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={[]} onSelect={onSelect} onCommitRects={vi.fn()} />);
    const surface = screen.getByTestId('page-surface-rt-amr-summary-p1');
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 700 });
    fireEvent.pointerUp(window, { clientX: 700, clientY: 700 });
    const ids = onSelect.mock.calls.at(-1)![0];
    expect(ids).toEqual(expect.arrayContaining(['amr-title', 'amr-table']));
  });

  it('drags a multi-selection and commits all their rects', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title', 'amr-subtitle']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    fireEvent.pointerDown(screen.getByTestId('el-amr-title'), { clientX: 50, clientY: 45, button: 0 });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 75 });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 75 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rects = onCommit.mock.calls[0][0];
    expect(rects.has('amr-title')).toBe(true);
    expect(rects.has('amr-subtitle')).toBe(true);
  });

  it('renders an alignment guide when a drag snaps into alignment', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-footer']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    // amr-footer starts at x=48 (aligned with title/subtitle/table left edges). Nudge +3 so its
    // left edge (51) is within the 6px snap threshold of x=48 → an x-guide should render.
    fireEvent.pointerDown(screen.getByTestId('el-amr-footer'), { clientX: 60, clientY: 1065, button: 0 });
    fireEvent.pointerMove(window, { clientX: 63, clientY: 1065 });
    expect(screen.getByTestId('guide')).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 63, clientY: 1065 });
  });
});

function tplWith(el: Partial<import('./types').DesignElement> & { id: string; kind: import('./types').ElementKind }, margins?: import('./types').Margins): ReportTemplate {
  return { id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [], margins,
    pages: [{ id: 'p1', elements: [{ name: el.id, rect: { x: 10, y: 10, w: 100, h: 40 }, ...el }] }] };
}

describe('PageCanvas group resize', () => {
  it('renders group handles for a 2+ selection, scales live, and commits scaled rects', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title', 'amr-subtitle']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    fireEvent.pointerDown(screen.getByTestId('group-handle-se'), { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    // both members are x:48,w:500 → group bbox x:48,w:500; se drag +40 → sx=1.08, anchored left:
    // the group box scales live to width 540 at left 48
    expect(screen.getByTestId('group-box')).toHaveStyle({ left: '48px', width: '540px' });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rects = onCommit.mock.calls[0][0] as Map<string, { x: number; w: number }>;
    expect(rects.get('amr-title')!.w).toBeCloseTo(540, 3);
    expect(rects.get('amr-subtitle')!.w).toBeCloseTo(540, 3);
    expect(rects.get('amr-title')!.x).toBeCloseTo(48, 3); // scaled about the left anchor
  });

  it('does not render group handles for a single selection', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.queryByTestId('group-handle-se')).toBeNull();
    expect(screen.getByTestId('handle-se')).toBeInTheDocument(); // element handles still show
  });
});

describe('PageCanvas inline text editing', () => {
  it('double-click a text element shows a textarea bound to its text; typing patches it; Escape exits', () => {
    const onPatchElement = vi.fn();
    const onEditEnd = vi.fn();
    const { rerender } = render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']}
      onSelect={vi.fn()} onCommitRects={vi.fn()} editingId={null} onEditStart={vi.fn()} onEditChange={onPatchElement} onEditEnd={onEditEnd} />);
    rerender(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']}
      onSelect={vi.fn()} onCommitRects={vi.fn()} editingId="amr-title" onEditStart={vi.fn()} onEditChange={onPatchElement} onEditEnd={onEditEnd} />);
    const ta = screen.getByTestId('edit-amr-title');
    fireEvent.change(ta, { target: { value: 'New' } });
    expect(onPatchElement).toHaveBeenCalledWith('amr-title', 'New');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(onEditEnd).toHaveBeenCalled();
  });

  it('does not start a drag when pointer-down lands on the edit textarea', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']}
      onSelect={vi.fn()} onCommitRects={onCommit} editingId="amr-title" onEditStart={vi.fn()} onEditChange={vi.fn()} onEditEnd={vi.fn()} />);
    const ta = screen.getByTestId('edit-amr-title');
    fireEvent.pointerDown(ta, { clientX: 20, clientY: 20, button: 0 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('exits inline edit on blur', () => {
    const onEditEnd = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']} editingId="amr-title"
      onSelect={vi.fn()} onCommitRects={vi.fn()} onEditStart={vi.fn()} onEditChange={vi.fn()} onEditEnd={onEditEnd} />);
    fireEvent.blur(screen.getByTestId('edit-amr-title'));
    expect(onEditEnd).toHaveBeenCalled();
  });

  it('scales the edit textarea font size by zoom', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={2} selectedIds={['amr-title']} editingId="amr-title"
      onSelect={vi.fn()} onCommitRects={vi.fn()} onEditStart={vi.fn()} onEditChange={vi.fn()} onEditEnd={vi.fn()} />);
    expect(screen.getByTestId('edit-amr-title')).toHaveStyle({ fontSize: '22px' }); // 11 * 2
  });

  it('does not enter edit mode on double-click of a non-text element', () => {
    const onEditStart = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} editingId={null}
      onSelect={vi.fn()} onCommitRects={vi.fn()} onEditStart={onEditStart} onEditChange={vi.fn()} onEditEnd={vi.fn()} />);
    fireEvent.doubleClick(screen.getByTestId('el-amr-table'));
    expect(onEditStart).not.toHaveBeenCalled();
  });
});

describe('PageCanvas style rendering', () => {
  it('renders a bold, colored, sized text element', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi', style: { bold: true, fontSize: 20, color: '#ff0000', align: 'center' } })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    const box = screen.getByText('Hi');
    expect(box).toHaveStyle({ fontWeight: '600', textAlign: 'center', fontSize: '20px', color: 'rgb(255, 0, 0)' });
  });

  it('renders an image element with a src', () => {
    render(<PageCanvas template={tplWith({ id: 'im', kind: 'image', src: 'http://x/y.png' })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://x/y.png');
  });

  it('renders a page margin guide when margins are set', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi' }, { top: 20, right: 20, bottom: 20, left: 20 })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByTestId('margin-guide')).toHaveStyle({ left: '20px', top: '20px', right: '20px', bottom: '20px' });
  });

  it('renders no margin guide when margins are unset', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi' })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.queryByTestId('margin-guide')).toBeNull();
  });
});

describe('PageCanvas keyvalue panel', () => {
  const kvTemplate = (el: Partial<import('./types').DesignElement>): ReportTemplate => ({
    id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [],
    pages: [{ id: 'p1', elements: [{
      id: 'kv', kind: 'keyvalue', name: 'Panel', rect: { x: 10, y: 10, w: 300, h: 80 }, ...el,
    } as import('./types').DesignElement] }],
  });

  it('shows the static sample pairs of an unbound panel', () => {
    render(<PageCanvas template={kvTemplate({ rows: [['Surname', 'MWASEKAGA']] })} zoom={1}
      selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByText('Surname')).toBeInTheDocument();
    expect(screen.getByText('MWASEKAGA')).toBeInTheDocument();
  });

  it('shows a BOUND panel as its labels with placeholder values — the canvas never runs the query', () => {
    render(<PageCanvas template={kvTemplate({
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'sn', label: 'Surname' }, { key: 'sex', label: 'Sex' }],
    })} zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByText('Surname')).toBeInTheDocument();
    expect(screen.getByText('Sex')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('draws the title bar only when the panel carries title text', () => {
    const { rerender } = render(<PageCanvas template={kvTemplate({ rows: [['A', 'B']] })} zoom={1}
      selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.queryByText('PATIENT')).not.toBeInTheDocument();
    rerender(<PageCanvas template={kvTemplate({ rows: [['A', 'B']], text: 'PATIENT' })} zoom={1}
      selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByText('PATIENT')).toBeInTheDocument();
  });
});

describe('PageCanvas barcode and QR', () => {
  const symTemplate = (el: Partial<import('./types').DesignElement>): ReportTemplate => ({
    id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [],
    pages: [{ id: 'p1', elements: [{
      id: 'sym', kind: 'barcode', name: 'Symbol', rect: { x: 10, y: 10, w: 200, h: 60 }, ...el,
    } as import('./types').DesignElement] }],
  });
  const render_ = (el: Partial<import('./types').DesignElement>) =>
    render(<PageCanvas template={symTemplate(el)} zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);

  it('draws real bars from the shared encoder, one rect per module', () => {
    const { container } = render_({ text: '1234567890' });
    // 90 modules for a 10-digit value (Code C); 45 of them are bars.
    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBeGreaterThan(20);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 90 10');
  });

  it('reserves the QR quiet zone in the preview too, so on-canvas size matches the print', () => {
    const { container } = render_({ kind: 'qrcode', text: 'TZ00123/26', rect: { x: 0, y: 0, w: 80, h: 80 } });
    // 21 modules + 4 quiet on each side = 29.
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 29 29');
  });

  it('shows a BOUND symbol muted, encoding the field label as a stand-in', () => {
    const { container } = render_({
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'lab_number', label: 'Lab number' }],
    });
    // Muted says "this is the shape, not the code" — a full-strength fake would be a scannable
    // wrong value sitting on the design surface.
    expect(container.querySelector('[style*="opacity"]')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('shows the caption only when enabled', () => {
    // ⚠ Scope each assertion to its own `container`: two `render()` calls in one test mount into
    // the SAME document, so a global `queryByText` still finds the first render's caption and the
    // negative assertion fails for a reason that has nothing to do with the component.
    const on = render_({ text: '1234567890' }).container;
    expect(within(on).getByText('1234567890')).toBeInTheDocument();
    const off = render_({ text: '1234567890', caption: false }).container;
    expect(within(off).queryByText('1234567890')).not.toBeInTheDocument();
  });

  it('falls back to a dashed placeholder for a value that cannot encode', () => {
    const { container } = render_({ text: '' });
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.border-dashed')).toBeTruthy();
  });
});

describe('PageCanvas letterhead tokens', () => {
  const tpl = (el: Partial<import('./types').DesignElement>): ReportTemplate => ({
    id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [],
    pages: [{ id: 'p1', elements: [{
      id: 'e', kind: 'text', name: 'El', rect: { x: 0, y: 0, w: 300, h: 20 }, ...el,
    } as import('./types').DesignElement] }],
  });
  const show = (el: Partial<import('./types').DesignElement>, identity?: Record<string, string>) =>
    render(<PageCanvas template={tpl(el)} zoom={1} selectedIds={[]} onSelect={vi.fn()}
      onCommitRects={vi.fn()} identity={identity} />);

  it('resolves {{lab.*}} so the letterhead is visible while it is positioned', () => {
    const { container } = show({ text: '{{lab.name}}' }, { name: 'Muhimbili' });
    expect(within(container).getByText('Muhimbili')).toBeInTheDocument();
  });

  it('renders an unset identity as blank, not as the literal token', () => {
    const { container } = show({ text: '{{lab.name}}' });
    expect(container.textContent).not.toContain('{{');
  });

  it('leaves {{param.x}} and {{date}} LITERAL — the canvas cannot know a run-time choice', () => {
    // Deliberate asymmetry: identity is static install-level data the canvas can know; a
    // parameter's value is chosen when the report is run.
    const { container } = show({ text: '{{param.site}} {{date}}' }, { name: 'Muhimbili' });
    expect(container.textContent).toContain('{{param.site}}');
    expect(container.textContent).toContain('{{date}}');
  });

  it('resolves a token image src, so the logo previews rather than showing a broken image', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const { container } = show({ kind: 'image', src: '{{lab.logo}}' }, { logo: png });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(png);
  });

  it('falls back to the image placeholder when the logo is unset', () => {
    const { container } = show({ kind: 'image', src: '{{lab.logo}}' });
    expect(container.querySelector('img')).toBeNull();
  });
});

function tplWithTable(el: DesignElement): ReportTemplate {
  return { id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [], pages: [{ id: 'p1', elements: [el] }] };
}
function renderTable(el: DesignElement) {
  render(<PageCanvas template={tplWithTable(el)} zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
}

describe('PageCanvas bound tables', () => {
  it('renders a bound table using its boundColumns labels, not the static columns', () => {
    renderTable({
      id: 't1', kind: 'table', name: 'Results', rect: { x: 0, y: 0, w: 200, h: 60 },
      columns: ['stale'],
      dataSource: { kind: 'custom-query', queryId: 'q1' },
      boundColumns: [{ key: 'organism', label: 'Organism' }, { key: 'n', label: 'Tested' }],
    });
    expect(screen.getByText('Organism')).toBeInTheDocument();
    expect(screen.getByText('Tested')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('renders the data-derived header marker for a bound (non-transposed) table with no boundColumns yet', () => {
    // Data tab's pickQuery sets `dataSource` and clears `boundColumns` in the same step, so every
    // table passes through exactly this state right after being bound. The PDF renderer falls back
    // to the resolved query's own columns here (`draw.ts` `tableHeaders`), so an empty header row on
    // the canvas would misrepresent a table the PDF prints fully populated.
    renderTable({
      id: 't1b', kind: 'table', name: 'Results', rect: { x: 0, y: 0, w: 200, h: 60 },
      dataSource: { kind: 'custom-query', queryId: 'q1' },
    });
    expect(screen.getByText('Headers from data')).toBeInTheDocument();
    expect(screen.getByText('Rows at render')).toBeInTheDocument();
  });

  it('renders a transposed table with its label and a data-derived header marker', () => {
    // A transposed table leaves boundColumns EMPTY by design — its headers are the organisms that
    // cleared the isolate threshold. The audit's "show boundColumns" minimum is a no-op here, and
    // this is the cumulative antibiogram, the table it most criticises.
    renderTable({
      id: 't2', kind: 'table', name: 'Antibiogram', rect: { x: 0, y: 0, w: 200, h: 60 },
      dataSource: { kind: 'custom-query', queryId: 'q2' },
      transpose: true, transposeLabel: 'Antimicrobial',
    });
    expect(screen.getByText('Antimicrobial')).toBeInTheDocument();
    expect(screen.getByText('Headers from data')).toBeInTheDocument();
    expect(screen.getByText('Rows at render')).toBeInTheDocument();
  });

  it('leaves an unbound table showing its static sample columns and rows', () => {
    renderTable({
      id: 't3', kind: 'table', name: 'Static', rect: { x: 0, y: 0, w: 200, h: 60 },
      columns: ['A', 'B'], rows: [['1', '2']],
    });
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
