import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PropertiesTab } from './PropertiesTab';
import { MOCK_TEMPLATES } from './mockTemplates';
import type { DesignElement, ReportTemplate } from './types';

const tpl = MOCK_TEMPLATES[0];
function setup(overrides = {}) {
  const props = { template: tpl, selectedIds: [] as string[], onPatchElement: vi.fn(), onPatchPage: vi.fn(), onPatchElements: vi.fn(), ...overrides };
  render(<PropertiesTab {...props} />);
  return props;
}

function tplWithEl(el: DesignElement): ReportTemplate {
  return { id: 't', name: 't', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [], pages: [{ id: 'p1', elements: [el] }] };
}

describe('PropertiesTab editing', () => {
  it('shows page settings and edits a margin when nothing is selected', () => {
    const props = setup({ selectedIds: [] });
    expect(screen.getByText('Page settings')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Margin top'), { target: { value: '12' } });
    expect(props.onPatchPage).toHaveBeenCalledWith(expect.objectContaining({ margins: expect.objectContaining({ top: 12 }) }));
  });

  it('toggles the page-numbers footer flag (discrete) when nothing is selected', () => {
    const props = setup({ selectedIds: [] });
    fireEvent.click(screen.getByLabelText('Page numbers'));
    expect(props.onPatchPage).toHaveBeenCalledWith({ pageNumbers: true }, { discrete: true });
  });

  it('edits X of a selected element (clamped, coalesced)', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '100' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', expect.objectContaining({ rect: expect.objectContaining({ x: 100 }) }));
  });

  it('shows the count for a multi-selection', () => {
    setup({ selectedIds: ['amr-title', 'amr-table'] });
    expect(screen.getByText('2 elements selected')).toBeInTheDocument();
  });

  it('clamps W to the minimum on blur', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    const w = screen.getByLabelText('W');
    fireEvent.change(w, { target: { value: '0' } });
    fireEvent.blur(w);
    expect(props.onPatchElement.mock.calls.at(-1)![1].rect.w).toBe(8);
  });

  it('edits text content (coalesced) and toggles bold (discrete)', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'New title' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', { text: 'New title' }, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', { style: { bold: true } }, { discrete: true });
  });

  it('adds a table column (discrete)', () => {
    const props = setup({ selectedIds: ['amr-table'] });
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-table', expect.objectContaining({ columns: expect.any(Array) }), { discrete: true });
  });

  it('shows the columns editor for an unbound table', () => {
    render(<PropertiesTab template={tplWithEl({ id: 'tb', kind: 'table', name: 'Table', rect: { x: 0, y: 0, w: 200, h: 100 }, columns: ['A', 'B'] })}
      selectedIds={['tb']} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add column/i })).toBeInTheDocument();
  });

  it('hides the columns editor for a bound table (Data tab owns its columns)', () => {
    render(<PropertiesTab template={tplWithEl({ id: 'tb', kind: 'table', name: 'Table', rect: { x: 0, y: 0, w: 200, h: 100 }, columns: ['A', 'B'], dataSource: { kind: 'custom-query', queryId: 'cq_1' } })}
      selectedIds={['tb']} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /add column/i })).toBeNull();
  });

  it('edits line stroke width (coalesced)', () => {
    const onPatchElement = vi.fn();
    render(<PropertiesTab template={tplWithEl({ id: 'ln', kind: 'line', name: 'Line', rect: { x: 0, y: 0, w: 100, h: 2 } })}
      selectedIds={['ln']} onPatchElement={onPatchElement} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Stroke width'), { target: { value: '3' } });
    expect(onPatchElement).toHaveBeenCalledWith('ln', { style: { strokeWidth: 3 } }, undefined);
  });

  it('edits rect fill color (coalesced hex)', () => {
    const onPatchElement = vi.fn();
    render(<PropertiesTab template={tplWithEl({ id: 'rc', kind: 'rect', name: 'Rect', rect: { x: 0, y: 0, w: 100, h: 100 } })}
      selectedIds={['rc']} onPatchElement={onPatchElement} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Fill hex'), { target: { value: '#123456' } });
    expect(onPatchElement).toHaveBeenCalledWith('rc', { style: { fill: '#123456' } }, undefined);
  });

  it('edits a token image source (coalesced)', () => {
    // A bare URL is no longer typeable here — see the `PropertiesTab image source` describe block
    // below. What remains editable as text is a token source, e.g. `{{lab.logo}}`.
    const onPatchElement = vi.fn();
    render(<PropertiesTab template={tplWithEl({ id: 'im', kind: 'image', name: 'Image', rect: { x: 0, y: 0, w: 100, h: 100 }, src: '{{lab.logo}}' })}
      selectedIds={['im']} onPatchElement={onPatchElement} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: '{{lab.other}}' } });
    expect(onPatchElement).toHaveBeenCalledWith('im', { src: '{{lab.other}}' }, undefined);
  });

  it('shows bulk text controls for an all-text multi-selection and applies bold to all', () => {
    const props = setup({ selectedIds: ['amr-title', 'amr-subtitle'] });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(props.onPatchElements).toHaveBeenCalledWith(['amr-title', 'amr-subtitle'], { style: { bold: true } }, { discrete: true });
  });

  it('shows only the count for a mixed-kind multi-selection', () => {
    setup({ selectedIds: ['amr-title', 'amr-table'] });
    expect(screen.getByText('2 elements selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });

  it('applies a bulk stroke width to an all-rect multi-selection', () => {
    const onPatchElements = vi.fn();
    const template: ReportTemplate = {
      id: 't', name: 't', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
      pages: [{ id: 'p1', elements: [
        { id: 'r1', kind: 'rect', name: 'Rect 1', rect: { x: 0, y: 0, w: 100, h: 100 } },
        { id: 'r2', kind: 'rect', name: 'Rect 2', rect: { x: 0, y: 0, w: 100, h: 100 } },
      ] }],
    };
    render(<PropertiesTab template={template} selectedIds={['r1', 'r2']} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={onPatchElements} />);
    fireEvent.change(screen.getByLabelText('Stroke width'), { target: { value: '3' } });
    expect(onPatchElements).toHaveBeenCalledWith(['r1', 'r2'], { style: { strokeWidth: 3 } }, undefined);
  });

  it('shows a Mixed placeholder for a size that differs across the text selection', () => {
    const template: ReportTemplate = {
      id: 't', name: 't', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
      pages: [{ id: 'p1', elements: [
        { id: 'x1', kind: 'text', name: 'Text 1', rect: { x: 0, y: 0, w: 100, h: 20 }, text: 'a', style: { fontSize: 12 } },
        { id: 'x2', kind: 'text', name: 'Text 2', rect: { x: 0, y: 0, w: 100, h: 20 }, text: 'b', style: { fontSize: 18 } },
      ] }],
    };
    render(<PropertiesTab template={template} selectedIds={['x1', 'x2']} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    const size = screen.getByLabelText('Size');
    expect(size).toHaveValue(null);
    expect(size).toHaveAttribute('placeholder', 'Mixed');
  });
});

describe('PropertiesTab keyvalue controls', () => {
  const kv = (over: Partial<DesignElement> = {}): DesignElement =>
    ({ id: 'kv', kind: 'keyvalue', name: 'Panel', rect: { x: 0, y: 0, w: 200, h: 80 }, ...over }) as DesignElement;

  it('edits the panel title, layout and pairs-per-line', () => {
    const el = kv();
    const props = setup({ template: tplWithEl(el), selectedIds: ['kv'] });
    fireEvent.change(screen.getByLabelText('Panel title'), { target: { value: 'PATIENT' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('kv', { text: 'PATIENT' }, undefined);
    fireEvent.change(screen.getByLabelText('Pairs per line'), { target: { value: '2' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('kv', { panelColumns: 2 }, undefined);
  });

  it('clamps pairs-per-line into 1..4 rather than passing a nonsense divisor to the renderer', () => {
    const props = setup({ template: tplWithEl(kv()), selectedIds: ['kv'] });
    fireEvent.change(screen.getByLabelText('Pairs per line'), { target: { value: '9' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('kv', { panelColumns: 4 }, undefined);
  });

  it('shows no static-pair editor — an unbound panel is made real by binding a query', () => {
    setup({ template: tplWithEl(kv({ rows: [['A', 'B']] })), selectedIds: ['kv'] });
    expect(screen.queryByText('Add column')).not.toBeInTheDocument();
  });
});

describe('PropertiesTab barcode and QR controls', () => {
  const sym = (over: Partial<DesignElement> = {}): DesignElement =>
    ({ id: 'sym', kind: 'barcode', name: 'B', rect: { x: 0, y: 0, w: 200, h: 60 }, ...over }) as DesignElement;

  it('edits the static value and toggles the caption', () => {
    const props = setup({ template: tplWithEl(sym({ text: '123' })), selectedIds: ['sym'] });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '456' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('sym', { text: '456' }, undefined);
    fireEvent.click(screen.getByLabelText('Show value under the bars'));
    expect(props.onPatchElement).toHaveBeenCalledWith('sym', { caption: false }, { discrete: true });
  });

  it('disables the static value when the symbol is bound, so the two cannot disagree', () => {
    setup({ template: tplWithEl(sym({ dataSource: { kind: 'custom-query', queryId: 'q' } })), selectedIds: ['sym'] });
    expect(screen.getByLabelText('Value')).toBeDisabled();
  });

  it('offers no caption toggle for a QR — it has no human-readable line', () => {
    setup({ template: tplWithEl(sym({ kind: 'qrcode' })), selectedIds: ['sym'] });
    expect(screen.queryByLabelText('Show value under the bars')).not.toBeInTheDocument();
  });
});

describe('PropertiesTab scannability hint', () => {
  const bc = (over: Partial<DesignElement> = {}): DesignElement =>
    ({ id: 'sym', kind: 'barcode', name: 'B', rect: { x: 0, y: 0, w: 220, h: 56 }, text: '1234567890', ...over }) as DesignElement;

  it('warns when the box is too narrow to scan, naming the measurement and the fix', () => {
    // 40px for a 90-module symbol is ~0.12mm per module — half the floor.
    setup({ template: tplWithEl(bc({ rect: { x: 0, y: 0, w: 40, h: 56 } })), selectedIds: ['sym'] });
    expect(screen.getByText(/too small to scan reliably/i)).toBeInTheDocument();
    expect(screen.getByText(/0\.12 mm per module/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 86 px/i)).toBeInTheDocument();
  });

  it('confirms, rather than nags, when the symbol is comfortably above the floor', () => {
    setup({ template: tplWithEl(bc()), selectedIds: ['sym'] });
    expect(screen.queryByText(/too small to scan/i)).not.toBeInTheDocument();
    // ⚠ Assert the FLOOR renders, not just the leading value. It shipped as `{{- min}}` (i18next's
    // unescaped-interpolation prefix) and printed the token LITERALLY in the running app — invisible
    // here because every assertion matched only the `{{mm}}` value at the start of the sentence.
    // An interpolation nothing asserts is one that can silently render as braces.
    expect(screen.getByText(/above the 0\.25 mm scanning minimum/i)).toBeInTheDocument();
  });

  it('leaves no un-interpolated token in any scannability line', () => {
    // One case per branch: warning, confirmation, budget.
    // ⚠ Scoped to the scannability paragraphs, NOT the whole panel: `symbolStaticHint` legitimately
    // contains `{{param.x}}` as literal example syntax, so a blanket body scan fails on correct copy.
    for (const el of [
      bc({ rect: { x: 0, y: 0, w: 40, h: 56 } }),
      bc(),
      bc({ dataSource: { kind: 'custom-query', queryId: 'q' }, text: '' }),
    ]) {
      const { unmount } = render(<PropertiesTab template={tplWithEl(el)} selectedIds={['sym']}
        onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
      const lines = [...document.querySelectorAll('p')]
        .map((p) => p.textContent ?? '')
        .filter((s) => /scannable|mm per module|too small/i.test(s));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).not.toMatch(/\{\{|\}\}/);
      unmount();
    }
  });

  it('resizes to the minimum scannable width, keeping the left edge and the height', () => {
    const el = bc({ rect: { x: 30, y: 10, w: 40, h: 56 } });
    const props = setup({ template: tplWithEl(el), selectedIds: ['sym'] });
    fireEvent.click(screen.getByRole('button', { name: /resize to the scanning minimum/i }));
    expect(props.onPatchElement).toHaveBeenCalledWith('sym',
      { rect: { x: 30, y: 10, w: 86, h: 56 } }, { discrete: true });
  });

  it('gives a BOUND barcode a character budget instead of a false pass/fail', () => {
    // The design is authored against one sample and then runs against every lab number the site
    // ever issues, so "this sample fits" would be a claim we cannot make.
    setup({ template: tplWithEl(bc({ dataSource: { kind: 'custom-query', queryId: 'q' }, text: '' })), selectedIds: ['sym'] });
    expect(screen.getByText(/up to 17 characters/i)).toBeInTheDocument();
    expect(screen.queryByText(/too small to scan/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resize to the scanning minimum/i })).toBeDisabled();
  });

  it('measures a QR against its SHORTER side, since the module pitch follows it', () => {
    // 200 wide but 20 tall: measuring width alone would call this comfortable.
    setup({ template: tplWithEl(bc({ kind: 'qrcode', rect: { x: 0, y: 0, w: 200, h: 20 } })), selectedIds: ['sym'] });
    expect(screen.getByText(/too small to scan reliably/i)).toBeInTheDocument();
  });
});

describe('PropertiesTab image source', () => {
  const imageEl = (src: string): DesignElement =>
    ({ id: 'i1', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 10, h: 10 }, src });

  it('offers a file picker for an image element instead of a bare URL field', () => {
    setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    expect(screen.getByTestId('image-file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose image…' })).toBeInTheDocument();
  });

  it('shows a token source as text and does not replace it with an upload widget', () => {
    // The nine built-in designs bind their logo to `{{lab.logo}}`; the panel must stay able to
    // show and edit that, not hide it behind a file picker.
    setup({ template: tplWithEl(imageEl('{{lab.logo}}')), selectedIds: ['i1'] });
    expect(screen.getByDisplayValue('{{lab.logo}}')).toBeInTheDocument();
    expect(screen.getByText('Resolved at render')).toBeInTheDocument();
    expect(screen.queryByTestId('image-file')).not.toBeInTheDocument();
  });

  it('shows the file picker, not the token text field, for a token merely EMBEDDED in another string', () => {
    // Regression guard for the unanchored /\{\{[^}]+\}\}/ test this mirrors from image-src.ts:
    // `https://x/logo.png?v={{n}}` contains a token but is not itself one — whatever it interpolates
    // to is still a URL, which pdfkit cannot render, so the server rejects it as `not-a-data-uri`.
    // The panel must not tell a different story by treating it as a valid editable token.
    setup({ template: tplWithEl(imageEl('https://x/logo.png?v={{n}}')), selectedIds: ['i1'] });
    expect(screen.getByTestId('image-file')).toBeInTheDocument();
    expect(screen.queryByText('Resolved at render')).not.toBeInTheDocument();
  });

  it('reads a valid PNG file into a data URI and patches the element (happy path)', async () => {
    const props = setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-file'), { target: { files: [png] } });
    await waitFor(() => expect(props.onPatchElement).toHaveBeenCalledWith(
      'i1', { src: expect.stringMatching(/^data:image\/png;base64,/) }, undefined,
    ));
  });

  it('resets the file input value after handling a pick, so re-choosing the same file fires change again', () => {
    // Without this, choosing logo.png, removing it, and choosing logo.png again is a no-op: the
    // input's `value` never changed, so no `change` event fires and neither the image nor an error
    // ever appears.
    setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    const input = screen.getByTestId('image-file') as HTMLInputElement;
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }); // rejection path too
    fireEvent.change(input, { target: { files: [svg] } });
    expect(input.value).toBe('');
  });

  it('rejects an oversize file without patching the element', () => {
    const props = setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    const big = new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-file'), { target: { files: [big] } });
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(props.onPatchElement).not.toHaveBeenCalled();
  });

  it('rejects an svg file without patching the element', () => {
    const props = setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByTestId('image-file'), { target: { files: [svg] } });
    expect(screen.getByText(/Unsupported image type/i)).toBeInTheDocument();
    expect(props.onPatchElement).not.toHaveBeenCalled();
  });

  it('clears a rejected-file error from one image element when a different element is selected', () => {
    // ImageSource holds local `error` state. Without a `key` on it, switching the selection to a
    // different element re-renders the SAME fiber instead of remounting it, so element B's panel
    // would still show element A's "too large" error even though B was never touched.
    const template: ReportTemplate = {
      id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [],
      pages: [{ id: 'p1', elements: [
        { id: 'a', kind: 'image', name: 'Image A', rect: { x: 0, y: 0, w: 10, h: 10 }, src: '' },
        { id: 'b', kind: 'image', name: 'Image B', rect: { x: 0, y: 0, w: 10, h: 10 }, src: '' },
      ] }],
    };
    const { rerender } = render(<PropertiesTab template={template} selectedIds={['a']}
      onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    const big = new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-file'), { target: { files: [big] } });
    expect(screen.getByText(/too large/i)).toBeInTheDocument();

    rerender(<PropertiesTab template={template} selectedIds={['b']}
      onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} />);
    expect(screen.queryByText(/too large/i)).not.toBeInTheDocument();
  });
});
