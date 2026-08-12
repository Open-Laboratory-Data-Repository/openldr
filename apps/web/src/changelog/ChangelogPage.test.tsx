import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { DAY_ENTRY_LIMIT } from '@/landing/changelog-model';
import { ChangelogPage } from './ChangelogPage';

vi.mock('@/landing/changelog.json', () => ({
  default: {
    generatedAt: '2026-08-12',
    days: [
      {
        date: '2026-08-12',
        version: 'v0.2.0',
        entries: [
          { hash: 'aaa1111', type: 'fix', scope: 'terminology', title: 'Escape shuts the panel' },
          { hash: 'bbb2222', type: 'feat', scope: 'web', title: 'Add a changelog page' },
          { hash: 'ccc3333', type: 'perf', scope: 'db', title: 'Chunk the migration' },
        ],
      },
      {
        date: '2026-08-04',
        version: null,
        entries: [{ hash: 'ddd4444', type: 'feat', scope: '', title: 'An older change' }],
      },
      {
        date: '2026-08-01',
        version: null,
        // A dozen entries, so the cap has something to hide.
        entries: Array.from({ length: 12 }, (_, index) => ({
          hash: `busy${index}`,
          type: index < 4 ? 'feat' : 'fix',
          scope: 'db',
          title: `Busy day change ${index}`,
        })),
      },
    ],
  },
}));

describe('ChangelogPage', () => {
  it('spells out each day and shows its version when one exists', () => {
    render(<ChangelogPage />);

    expect(screen.getByRole('heading', { name: 'Changelog', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AUGUST 12, 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AUGUST 4, 2026' })).toBeInTheDocument();
    expect(screen.getByText('v0.2.0')).toBeInTheDocument();
  });

  it('groups a day by what the reader cares about, new before fixed', () => {
    render(<ChangelogPage />);
    const day = screen.getByRole('region', { name: 'AUGUST 12, 2026' });
    const groups = within(day).getAllByRole('heading', { level: 3 });

    expect(groups.map((heading) => heading.textContent)).toEqual(['New', 'Fixed', 'Faster']);
  });

  it('shows the scope beside a title, and omits it when the commit had none', () => {
    render(<ChangelogPage />);

    expect(screen.getByText('terminology')).toBeInTheDocument();
    expect(screen.getByText('An older change')).toBeInTheDocument();
  });

  it('caps a long day and reveals the rest on demand', () => {
    render(<ChangelogPage />);
    const day = screen.getByRole('region', { name: 'AUGUST 1, 2026' });

    expect(within(day).getAllByRole('listitem')).toHaveLength(DAY_ENTRY_LIMIT);
    const more = within(day).getByRole('button', { name: `Show ${12 - DAY_ENTRY_LIMIT} more →` });

    fireEvent.click(more);
    expect(within(day).getAllByRole('listitem')).toHaveLength(12);

    fireEvent.click(within(day).getByRole('button', { name: 'Show less' }));
    expect(within(day).getAllByRole('listitem')).toHaveLength(DAY_ENTRY_LIMIT);
  });

  it('leaves a short day alone, with nothing to expand', () => {
    render(<ChangelogPage />);
    const day = screen.getByRole('region', { name: 'AUGUST 4, 2026' });

    expect(within(day).queryByRole('button')).not.toBeInTheDocument();
  });
});
