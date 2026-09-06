import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';

function Harness({ onChange }: { onChange: (v: string) => void }) {
  return (
    <Select defaultValue="en" onValueChange={onChange}>
      <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="en">EN</SelectItem>
        <SelectItem value="fr">FR</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe('Select', () => {
  it('shows the current value on the trigger', () => {
    render(<Harness onChange={() => {}} />);
    expect(screen.getByLabelText('Language')).toHaveTextContent('EN');
  });
  it('opens and selects an option', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Language'));
    fireEvent.click(screen.getByText('FR'));
    expect(onChange).toHaveBeenCalledWith('fr');
  });

  // ⛔ A long list used to be UNREACHABLE. This content had `overflow-hidden` and no height bound,
  // so a Select with more items than fit on screen grew past the viewport and had the overflow
  // clipped away, with no way to reach the items above the fold. Measured on the facility import
  // column map, which offers 16 contract fields plus "Not mapped".
  //
  // ⚠ jsdom has NO LAYOUT, so it cannot prove the list actually scrolls. What it can prove is that
  // the two mechanisms that make it scrollable are still wired up. The behaviour itself was
  // confirmed in a real browser at 375px; see the commit message.
  describe('a list too long for the screen', () => {
    function Long() {
      return (
        <Select defaultValue="i0">
          <SelectTrigger aria-label="Long"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 20 }, (_, i) => (
              <SelectItem key={i} value={`i${i}`}>{`Item ${i}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    it('bounds its height to the room Radix says is available', () => {
      render(<Long />);
      fireEvent.click(screen.getByLabelText('Long'));
      // Radix exposes no data attribute on Content itself, so reach it through the viewport.
      const content = document.querySelector('[data-radix-select-viewport]')?.parentElement;
      expect(content?.className).toContain('max-h-[var(--radix-select-content-available-height)]');
    });

    it('gives the viewport its own scroll', () => {
      render(<Long />);
      fireEvent.click(screen.getByLabelText('Long'));
      expect(document.querySelector('[data-radix-select-viewport]')?.className).toContain('overflow-y-auto');
    });

    // ⚠ HONEST NON-PROOF. The scroll BUTTONS cannot be asserted here at all. Radix mounts them only
    // when the list is actually scrollable, and jsdom has no layout, so nothing is ever scrollable
    // and they never render. They are the half that matters inside a Sheet, where the portalled
    // list gets no native scrolling from react-remove-scroll. Only a browser can prove that half;
    // it was confirmed at 375px before this shipped.
  });
});
