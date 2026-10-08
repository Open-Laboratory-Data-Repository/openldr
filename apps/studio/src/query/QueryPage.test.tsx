// apps/studio/src/query/QueryPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EditorView } from 'codemirror';
import type { ReactNode } from 'react';
import '@/i18n';
import { QueryPage } from './QueryPage';
import { useQueryStore, type QueryTab } from './store';
import { queryApi } from './api';

vi.mock('../shell/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  datasets: vi.fn(async () => []),
  list: vi.fn(async () => []),
  run: vi.fn(async () => ({ columns: [], rows: [], rowCount: 0, ms: 1 })),
} }));

const facilities: QueryTab = { id: 'qa', kind: 'query', title: 'Facilities', customQueryId: 'cq-a', connectorId: 'c1', sql: 'select * from facility_registry', params: [], dirty: false };
const vlInfo: QueryTab = { id: 'qb', kind: 'query', title: 'VL info', customQueryId: 'cq-b', connectorId: 'c1', sql: "select 'VIRAL' as kind", params: [], dirty: false };

// The visible editor is CodeMirror; the sr-only textarea mirrors props, so read the live view.
// Inactive tabs stay built but hidden, so pick the editor outside any hidden wrapper.
function editor(container: HTMLElement): EditorView {
  const content = [...container.querySelectorAll('.cm-content')].find((el) => !el.closest('[hidden]'));
  if (!content) throw new Error('no CodeMirror editor rendered');
  const view = EditorView.findFromDOM(content as HTMLElement);
  if (!view) throw new Error('no EditorView for .cm-content');
  return view;
}

describe('QueryPage workspace', () => {
  beforeEach(() => vi.clearAllMocks());
  beforeEach(() => useQueryStore.setState({ tabs: [{ ...facilities }, { ...vlInfo }], activeId: facilities.id }));

  it('shows the active query tab SQL in the editor after a tab switch', () => {
    const { container } = render(<MemoryRouter><QueryPage /></MemoryRouter>);
    expect(editor(container).state.doc.toString()).toBe(facilities.sql);
    act(() => useQueryStore.getState().setActive(vlInfo.id));
    expect(editor(container).state.doc.toString()).toBe(vlInfo.sql);
  });

  it('writes editor changes into the active tab, not the first one opened', () => {
    const { container } = render(<MemoryRouter><QueryPage /></MemoryRouter>);
    act(() => useQueryStore.getState().setActive(vlInfo.id));
    const view = editor(container);
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' -- edited' } }));
    const [a, b] = useQueryStore.getState().tabs as QueryTab[];
    expect(a.sql).toBe(facilities.sql);
    expect(b.sql).toBe(`${vlInfo.sql} -- edited`);
  });

  it('keeps a tab results when you switch away and back', async () => {
    render(<MemoryRouter><QueryPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(await screen.findByText('0 rows · 1ms')).toBeInTheDocument();
    act(() => useQueryStore.getState().setActive(vlInfo.id));
    act(() => useQueryStore.getState().setActive(facilities.id));
    expect(screen.getByText('0 rows · 1ms')).toBeVisible();
    expect(queryApi.run).toHaveBeenCalledTimes(1);
  });
});
