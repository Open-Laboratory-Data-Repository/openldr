import { render, screen, within } from '@testing-library/react';
import { MarketplaceTable } from './MarketplaceTable';

describe('MarketplaceTable', () => {
  it('introduces the marketplace under its own heading', () => {
    render(<MarketplaceTable />);

    expect(screen.getByRole('heading', { name: /extend it without forking it/i, level: 2 })).toBeInTheDocument();
  });

  it('ticks what an artifact can do today', () => {
    render(<MarketplaceTable />);

    const row = screen.getByRole('row', { name: /adds nodes to the workflow builder/i });
    expect(within(row).getByLabelText('Supported')).toBeInTheDocument();
  });

  // A tick beside something unfinished is the failure that matters here: a reader would install
  // OpenLDR expecting it. Unfinished rows carry a muted label instead.
  it.each([
    ['ships ready-made forms', 'planned'],
    ['ships ready-made reports', 'planned'],
    ['extends the studio with its own screens', 'packaging only'],
  ])('marks "%s" as %s rather than ticking it', (label, note) => {
    render(<MarketplaceTable />);

    const row = screen.getByRole('row', { name: new RegExp(label, 'i') });
    expect(within(row).getByText(note)).toBeInTheDocument();
    expect(within(row).queryByLabelText('Supported')).not.toBeInTheDocument();
  });
});
