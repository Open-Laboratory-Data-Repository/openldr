import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import { PayloadPreview } from './PayloadPreview';

describe('PayloadPreview content pack', () => {
  it('lists one row per step with its name, count and label', () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [
        { kind: 'value-set', label: 'Specimen types', count: 12 },
        { kind: 'facility-register', label: 'National register', count: 3400 },
        { kind: 'custom-queries', label: 'Monthly reports', count: 5 },
      ],
    }} />);
    const rows = screen.getAllByTestId('pack-step');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Value set');
    expect(rows[0].textContent).toContain('12');
    expect(rows[0].textContent).toContain('Specimen types');
    expect(rows[1].textContent).toContain('Facility register');
    expect(rows[1].textContent).toContain('3400');
    expect(rows[2].textContent).toContain('Custom queries');
    expect(screen.queryByText(/packStep/)).toBeNull();
  });
});
