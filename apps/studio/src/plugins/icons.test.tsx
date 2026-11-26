import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Database, Plug, Puzzle } from 'lucide-react';
import { pluginIcon, pluginNavIcon } from './icons';

const ICON = ['M3 15 5.5 5.5h13L21 15v4.5H3Z', 'M3.5 15h17', 'M8 11h2l1.4-3 2 4 1.4-2H17'];

describe('pluginNavIcon', () => {
  it('draws each path in a Studio-owned svg with Studio styling', () => {
    const Icon = pluginNavIcon({ icon: 'plug', iconPaths: ICON });
    const { container } = render(<Icon className="h-4 w-4" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toBe('h-4 w-4');
    expect([...svg.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(ICON);
    // Only path elements, each with only a d attribute.
    expect([...svg.children].every((c) => c.tagName === 'path' && c.attributes.length === 1)).toBe(true);
  });

  it('gives the same component for the same paths, so a re-render does not remount', () => {
    expect(pluginNavIcon({ iconPaths: [...ICON] })).toBe(pluginNavIcon({ iconPaths: [...ICON] }));
  });

  it('keeps the named icons and the puzzle fallback', () => {
    expect(pluginNavIcon({ icon: 'database' })).toBe(Database);
    expect(pluginNavIcon({ icon: 'no-such-icon' })).toBe(Puzzle);
    expect(pluginNavIcon({})).toBe(Puzzle);
    expect(pluginIcon('plug')).toBe(Plug);
  });

  it('falls back to the named icon when the paths are not path data', () => {
    expect(pluginNavIcon({ icon: 'plug', iconPaths: ['<script>alert(1)</script>'] })).toBe(Plug);
    expect(pluginNavIcon({ icon: 'plug', iconPaths: ['M0 0 url(x)'] })).toBe(Plug);
    expect(pluginNavIcon({ icon: 'plug', iconPaths: [] })).toBe(Plug);
    expect(pluginNavIcon({ icon: 'plug', iconPaths: 'M0 0h1' })).toBe(Plug);
  });
});
