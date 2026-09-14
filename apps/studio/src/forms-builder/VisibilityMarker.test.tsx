import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisibilityMarker } from './VisibilityMarker';

describe('VisibilityMarker', () => {
  it('marks a rule with conditions as Conditional', () => {
    render(<VisibilityMarker rule={{ combinator: 'all', conditions: [{ fieldId: 'x', operator: 'isNotEmpty' }] }} />);
    expect(screen.getByRole('img', { name: 'Conditional' })).toBeTruthy();
  });

  it('draws nothing with no rule or an empty one', () => {
    const { container, rerender } = render(<VisibilityMarker rule={undefined} />);
    expect(container.firstChild).toBeNull();
    rerender(<VisibilityMarker rule={{ combinator: 'all', conditions: [] }} />);
    expect(container.firstChild).toBeNull();
  });
});
