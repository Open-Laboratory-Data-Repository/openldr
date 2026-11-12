import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FileText, LayoutDashboard } from 'lucide-react';
import '@/i18n/index';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarNav, navSlots, type SidebarNavEntry } from './SidebarNav';

/**
 * The sidebar rail at a short window. The links used to shrink to the icon's own 16px, so every
 * icon looked tiny, and then a scrollbar appeared. Links now keep their size, and those that do not
 * fit go into a ⋯ menu at the bottom.
 */

const items: SidebarNavEntry[] = Array.from({ length: 15 }, (_, i) => ({
  key: `p${i}`, to: `/p${i}`, end: false, icon: i % 2 ? FileText : LayoutDashboard, label: `Page ${i}`,
}));

/** jsdom has no layout. Report the nav's height through ResizeObserver, as a browser would. */
function stubHeight(px: number) {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => px });
      this.cb([{ contentRect: { height: px } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
}

function renderNav(path = '/p0', collapsed = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <SidebarNav items={items} collapsed={collapsed} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('navSlots', () => {
  it('shows every link when they all fit', () => {
    expect(navSlots(15, 700)).toEqual({ shown: 15, more: false });
  });

  it('keeps one slot for the ⋯ button when they do not', () => {
    // 319px of nav: 8px padding each end, 36px links with 4px gaps, so 7 slots.
    expect(navSlots(15, 319)).toEqual({ shown: 6, more: true });
  });

  it('shows every link when the height is not known yet', () => {
    expect(navSlots(15, 0)).toEqual({ shown: 15, more: false });
  });
});

describe('SidebarNav at a short window', () => {
  it('keeps every link one size and never scrolls', () => {
    stubHeight(319);
    renderNav();
    const nav = screen.getByRole('navigation');
    expect(nav.className).not.toMatch(/overflow-y-auto/);
    for (const link of screen.getAllByRole('link')) expect(link.className).toMatch(/\bshrink-0\b/);
  });

  it('shows what fits and puts the rest behind a ⋯ menu', () => {
    stubHeight(319);
    renderNav();
    expect(screen.getAllByRole('link')).toHaveLength(6);
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /Page 6/ })) fireEvent.keyDown(more, { key: 'Enter' });
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(
      ['Page 6', 'Page 7', 'Page 8', 'Page 9', 'Page 10', 'Page 11', 'Page 12', 'Page 13', 'Page 14'],
    );
  });

  it('marks the ⋯ button when the page you are on is in the menu', () => {
    stubHeight(319);
    renderNav('/p12');
    expect(screen.getByRole('button', { name: 'More' }).className).toMatch(/text-primary/);
  });

  it('shows no ⋯ button when everything fits', () => {
    stubHeight(800);
    renderNav();
    expect(screen.getAllByRole('link')).toHaveLength(15);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});
