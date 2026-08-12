import { render, screen } from '@testing-library/react';
import { FeatureGrid } from './FeatureGrid';

const CARDS = [
  'Multi-database support',
  'Authentication',
  'Distributed sync',
  'Storage',
  'Workflows',
  'Terminology',
  'Data APIs',
];

describe('FeatureGrid', () => {
  it('names every feature the section claims', () => {
    render(<FeatureGrid />);

    for (const card of CARDS) {
      expect(screen.getByRole('heading', { name: card, level: 3 })).toBeInTheDocument();
    }
  });

  it('sits under one section heading', () => {
    render(<FeatureGrid />);

    expect(
      screen.getByRole('heading', { name: /everything a laboratory network needs/i, level: 2 }),
    ).toBeInTheDocument();
  });

  // The storage tiles are decoration, but decoration still makes a claim: a film reel says the
  // product handles video, which it does not. Scans and SQLite imports are real, so they stay.
  it('draws only what OpenLDR actually stores', () => {
    const { container } = render(<FeatureGrid />);
    const storage = [...container.querySelectorAll('section')].find((section) =>
      section.querySelector('h3')?.textContent?.includes('Storage'),
    );
    const tiles = [...(storage?.querySelectorAll('[aria-hidden="true"] svg') ?? [])].map(
      (svg) => svg.getAttribute('class') ?? '',
    );

    expect(tiles.length).toBeGreaterThan(4);
    expect(
      tiles.every((cls) =>
        /lucide-file-|lucide-database|lucide-image|lucide-scan-text|lucide-test-tubes/.test(cls),
      ),
    ).toBe(true);
    expect(tiles.some((cls) => /lucide-film|lucide-video|lucide-music/.test(cls))).toBe(false);
    // Every tile a different thing — a repeat reads as filler rather than as a file type.
    expect(new Set(tiles).size).toBe(tiles.length);
    // file-code and file-json are both brace glyphs and are indistinguishable at 18px, so only
    // one of the pair belongs in the grid.
    expect(tiles.some((cls) => /lucide-file-archive/.test(cls))).toBe(true);
    expect(tiles.some((cls) => /lucide-file-code/.test(cls))).toBe(false);
  });

  it('does not claim a feature OpenLDR has not built', () => {
    render(<FeatureGrid />);

    // Vector search and realtime are Supabase's cards, not ours — this section is copied from
    // their layout, and it would be easy to copy the claims with it.
    expect(screen.queryByText(/vector/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/realtime|multiplayer/i)).not.toBeInTheDocument();
  });
});
