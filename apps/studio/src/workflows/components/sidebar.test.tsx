import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Sidebar } from './sidebar';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({
  ...(await orig<typeof api>()),
  fetchWorkflowNodes: vi.fn(),
}));

beforeEach(() => {
  (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('Sidebar palette categories', () => {
  it('renders categories collapsed by default and expands on header click', async () => {
    render(<Sidebar />);
    // The "Core" category header is always shown, but its items are hidden initially.
    const coreHeader = await screen.findByText('Core');
    expect(screen.queryByText('Manual Trigger')).not.toBeInTheDocument();

    // Click the category header button to expand it.
    const headerButton = coreHeader.closest('button');
    expect(headerButton).toBeTruthy();
    fireEvent.click(headerButton!);

    await waitFor(() => expect(screen.getByText('Manual Trigger')).toBeInTheDocument());
  });
});

// jsdom has no matchMedia; fake one whose width can change after render. It applies the
// max-width in the query, so a page that passes its own breakpoint is checked against it.
let viewportWidth = 1280;
const viewportListeners = new Set<() => void>();
function fakeMatchMedia(): void {
  viewportWidth = 1280;
  viewportListeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() { return viewportWidth <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity); },
    media: query,
    addEventListener: (_: string, fn: () => void) => viewportListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => viewportListeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
}
const resizeTo = (w: number) => act(() => { viewportWidth = w; viewportListeners.forEach((fn) => fn()); });

describe('Sidebar narrow viewport', () => {
  beforeEach(fakeMatchMedia);
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

  it('collapses the node library when the viewport narrows after a wide load', async () => {
    render(<Sidebar />);
    expect(await screen.findByRole('button', { name: 'Collapse node library' })).toBeInTheDocument();
    resizeTo(375);
    expect(screen.getByRole('button', { name: 'Expand node library' })).toBeInTheDocument();
  });
});
