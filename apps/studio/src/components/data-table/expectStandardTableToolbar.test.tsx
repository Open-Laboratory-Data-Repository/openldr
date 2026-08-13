import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise i18next so useTranslation() resolves
import { DataTableToolbar } from './DataTableToolbar';
import { ActiveFilterChips } from './ActiveFilterChips';
import { addFilterViaPopover, expectStandardTableToolbar } from './expectStandardTableToolbar';
import type { ColumnDef, FilterRule } from './types';

const columns: ColumnDef<{ id: string; name: string }>[] = [
  { id: 'name', labelKey: 'roles.colName', accessor: (r) => r.name, type: 'text', defaultVisible: true },
];

function Harness({ withChips }: { withChips: boolean }) {
  return (
    <div>
      <DataTableToolbar
        columns={columns}
        filters={[]} onFiltersChange={vi.fn()}
        sorts={[]} onSortsChange={vi.fn()}
        visibleIds={['name']} onVisibleIdsChange={vi.fn()}
        onResetColumns={vi.fn()} onResetAll={vi.fn()}
        searchValue="" onSearchChange={vi.fn()} searchPlaceholder="Search"
      />
      {withChips && (
        <ActiveFilterChips
          columns={columns}
          filters={[{ id: 'f1', column: 'name', operator: 'eq', value: 'x', combine: 'and' }]}
          onChange={vi.fn()}
        />
      )}
    </div>
  );
}

/** Stateful harness: filters applied through the popover actually land, so chips appear. */
function LiveHarness() {
  const [filters, setFilters] = useState<FilterRule[]>([]);
  return (
    <div>
      <DataTableToolbar
        columns={columns}
        filters={filters} onFiltersChange={setFilters}
        sorts={[]} onSortsChange={vi.fn()}
        visibleIds={['name']} onVisibleIdsChange={vi.fn()}
        onResetColumns={vi.fn()} onResetAll={vi.fn()}
        searchValue="" onSearchChange={vi.fn()} searchPlaceholder="Search"
      />
      <ActiveFilterChips columns={columns} filters={filters} onChange={setFilters} />
    </div>
  );
}

describe('expectStandardTableToolbar', () => {
  it('passes when the toolbar and the chips container are both rendered', () => {
    render(<Harness withChips />);
    expect(() => expectStandardTableToolbar()).not.toThrow();
  });

  it('fails when the page rendered the toolbar but forgot ActiveFilterChips', () => {
    render(<Harness withChips={false} />);
    expect(() => expectStandardTableToolbar()).toThrow(/ActiveFilterChips/);
  });
});

describe('addFilterViaPopover', () => {
  it('applies a rule through the popover so the chips row appears', async () => {
    render(<LiveHarness />);
    expect(screen.queryByText(/clear all/i)).toBeNull();   // no chips before

    await addFilterViaPopover('acme');

    expect(await screen.findByText(/clear all/i)).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();  // the value shows on the chip
    expectStandardTableToolbar();
  });
});
