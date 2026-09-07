import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestCombobox } from './suggest-combobox';
import * as truncatedTextModule from './truncated-text';

const cities = ['Kampala', 'Kigali', 'Kisumu'];

describe('SuggestCombobox', () => {
  it('renders a combobox', () => {
    render(<SuggestCombobox value="" onChange={() => {}} options={cities} label="City" />);
    expect(screen.getByRole('combobox', { name: 'City' })).toBeInTheDocument();
  });

  it('filters the visible suggestions as the user types', () => {
    // SuggestCombobox is a controlled component (value comes from the caller), so — as with
    // Input and Combobox elsewhere in this directory — a single fireEvent.change sets the full
    // typed value in one shot rather than simulating a static prop being typed into keystroke
    // by keystroke.
    render(<SuggestCombobox value="ki" onChange={() => {}} options={cities} label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    fireEvent.focus(input);
    expect(screen.getByText('Kigali')).toBeInTheDocument();
    expect(screen.getByText('Kisumu')).toBeInTheDocument();
    expect(screen.queryByText('Kampala')).not.toBeInTheDocument();
  });

  it('picking a suggestion sets the answer to that plain string', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={onChange} options={cities} label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    await user.click(screen.getByText('Kigali'));
    expect(onChange).toHaveBeenCalledWith('Kigali');
  });

  it('accepts a typed value that is not in the suggestion list, verbatim', () => {
    const onChange = vi.fn();
    render(<SuggestCombobox value="" onChange={onChange} options={cities} label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    fireEvent.change(input, { target: { value: 'Somewhere New' } });
    expect(onChange).toHaveBeenLastCalledWith('Somewhere New');
  });

  it('shows a "no suggestions" state, distinct from loading, for an empty ready list', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={() => {}} options={[]} status="ready" label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByText(/no suggestions/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('shows a loading state distinct from "no suggestions"', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={() => {}} options={[]} status="loading" label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/no suggestions/i)).not.toBeInTheDocument();
  });

  it('still allows free typing while the suggestion list is empty', () => {
    const onChange = vi.fn();
    render(<SuggestCombobox value="" onChange={onChange} options={[]} status="ready" label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    fireEvent.change(input, { target: { value: 'Anywhere' } });
    expect(onChange).toHaveBeenLastCalledWith('Anywhere');
  });

  it('shows an error state with the given message', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={() => {}} options={[]} status="error" error="boom" label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('sets aria-activedescendant to the keyboard-active option id', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox id="city" value="" onChange={() => {}} options={cities} label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    await user.click(input);
    expect(input).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'city-suggest-option-0');
  });
});

describe('SuggestCombobox — optionLabels', () => {
  const registers = { 'urn:zm:mfl': 'Zambia MFL', 'urn:tz:hfr': 'Tanzania HFR' };

  it('shows the LABEL while the option value stays the stored one', () => {
    // The facility register field stores a canonical URI because `idFor` hashes exactly that string
    // into every facility's permanent id — but an operator should be choosing "Zambia MFL".
    const onChange = vi.fn();
    render(
      <SuggestCombobox
        value="" onChange={onChange}
        options={['urn:zm:mfl', 'urn:tz:hfr']} optionLabels={registers}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Zambia MFL')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Zambia MFL'));
    expect(onChange).toHaveBeenCalledWith('urn:zm:mfl');
  });

  it('matches a query against the label, not only the value', () => {
    render(
      <SuggestCombobox
        value="zambia" onChange={vi.fn()}
        options={['urn:zm:mfl', 'urn:tz:hfr']} optionLabels={registers}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Zambia MFL')).toBeInTheDocument();
    expect(screen.queryByText('Tanzania HFR')).not.toBeInTheDocument();
  });

  it('falls back to the raw value when no label is given', () => {
    render(<SuggestCombobox value="" onChange={vi.fn()} options={['urn:zm:mfl']} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('urn:zm:mfl')).toBeInTheDocument();
  });
});

describe('SuggestCombobox — optionDescriptions', () => {
  const paths = ['Location.address.district', 'Location.name'];
  const descriptions = { 'Location.address.district': 'District name (aka county)' };

  it('renders both the label and the description for an option that has one', () => {
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Location.address.district')).toBeInTheDocument();
    expect(screen.getByText('District name (aka county)')).toBeInTheDocument();
  });

  it('renders only the label, with no empty second line, for an option without a description', () => {
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const option = screen.getByRole('option', { name: 'Location.name' });
    expect(option.children).toHaveLength(1);
  });

  it('filters to an option whose description matches, even when the query is absent from the path', () => {
    render(
      <SuggestCombobox
        value="county" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Location.address.district')).toBeInTheDocument();
    expect(screen.queryByText('Location.name')).not.toBeInTheDocument();
  });

  it('commits the option VALUE when picked, not the label or the description', () => {
    const onChange = vi.fn();
    render(
      <SuggestCombobox
        value="" onChange={onChange}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('District name (aka county)'));
    expect(onChange).toHaveBeenCalledWith('Location.address.district');
  });

  it('gives an option with a description a well-formed accessible name, label comma description', () => {
    // The label and description render as two sibling elements with no whitespace between
    // them, so the DOM text content runs them together: "districtDistrict name (aka county)".
    // A screen reader reads that concatenation. The option needs an explicit aria-label so its
    // accessible name is well-formed regardless of DOM whitespace.
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const option = screen.getByRole('option', { name: 'Location.address.district, District name (aka county)' });
    expect(option).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /districtDistrict/ })).not.toBeInTheDocument();
  });

  it('leaves an option without a description with no aria-label, so its name still comes from its content', () => {
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const option = screen.getByRole('option', { name: 'Location.name' });
    expect(option).not.toHaveAttribute('aria-label');
  });

  it('gives the label a width constraint so truncate can actually clip a long path', () => {
    // `truncate` (block + overflow-hidden + text-overflow: ellipsis) does nothing unless the
    // element also has a bounded width. In the two-line column layout the label is a flex item;
    // without an explicit width claim it sizes to its own content instead of the row's width,
    // so a long path renders in full and gets hard-clipped by the listbox instead of showing
    // an ellipsis. `truncate` alone is not enough, so this asserts both classes are present.
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const label = screen.getByText('Location.address.district');
    expect(label.className).toContain('truncate');
    expect(label.className).toContain('w-full');
  });

  it('keeps the description wrapping across lines, never truncated', () => {
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const description = screen.getByText('District name (aka county)');
    expect(description.className).toContain('whitespace-normal');
    expect(description.className).not.toContain('truncate');
  });

  it('leaves the no-description option class string byte-identical to the single-line layout', () => {
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionDescriptions={descriptions}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const option = screen.getByRole('option', { name: 'Location.name' });
    expect(option.className).toBe(
      'flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent ',
    );
  });
});

describe('SuggestCombobox optionLabelTruncateFrom', () => {
  const paths = ['Location.address.period'];

  it('clips an option label from the end by default', () => {
    render(<SuggestCombobox value="" onChange={vi.fn()} options={paths} />);
    fireEvent.focus(screen.getByRole('combobox'));
    const label = screen.getByText('Location.address.period');
    expect(label.className).not.toContain('[direction:rtl]');
  });

  it('optionLabelTruncateFrom="start" reaches the option label', () => {
    // jsdom has no layout and no canvas, so there is nothing to measure and no pixel cut to
    // assert here (TruncatedText falls back to the full text either way under jsdom). What
    // this test can honestly check is that the prop is actually threaded through to the
    // label's TruncatedText, by spying on the real component rather than asserting CSS.
    const spy = vi.spyOn(truncatedTextModule, 'TruncatedText');
    render(
      <SuggestCombobox
        value="" onChange={vi.fn()}
        options={paths} optionLabelTruncateFrom="start"
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    screen.getByText('Location.address.period');
    const reachedStart = spy.mock.calls.some((call) => call[0].truncateFrom === 'start');
    expect(reachedStart).toBe(true);
    spy.mockRestore();
  });
});

describe('SuggestCombobox — Escape and an enclosing dismissable layer', () => {
  const cities = ['Kampala', 'Kigali', 'Kisumu'];

  /** Radix's `useEscapeKeydown` (@radix-ui/react-use-escape-keydown) registers on `document` with
   *  `{ capture: true }`, so a Sheet or Dialog decides to close during the CAPTURE phase, before
   *  any bubble-phase handler inside it runs. This stands in for that listener exactly, so the
   *  tests below prove the real interaction without mounting a whole Sheet. */
  function withDocumentEscapeListener(): { seen: () => number; stop: () => void } {
    let count = 0;
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') count += 1; };
    document.addEventListener('keydown', handler, { capture: true });
    return { seen: () => count, stop: () => document.removeEventListener('keydown', handler, { capture: true }) };
  }

  it('⛔ swallows Escape while the list is open, so an enclosing sheet does not also close', () => {
    const layer = withDocumentEscapeListener();
    try {
      render(<SuggestCombobox value="" onChange={vi.fn()} options={cities} label="City" />);
      const input = screen.getByRole('combobox', { name: 'City' });
      fireEvent.focus(input);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByRole('listbox')).toBeNull();
      expect(layer.seen()).toBe(0);
    } finally {
      layer.stop();
    }
  });

  it('lets Escape through when the list is closed, so the sheet still dismisses', () => {
    const layer = withDocumentEscapeListener();
    try {
      render(<SuggestCombobox value="" onChange={vi.fn()} options={cities} label="City" />);
      const input = screen.getByRole('combobox', { name: 'City' });
      expect(screen.queryByRole('listbox')).toBeNull();

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(layer.seen()).toBe(1);
    } finally {
      layer.stop();
    }
  });

  it('lets every other key through untouched', () => {
    const layer = withDocumentEscapeListener();
    let others = 0;
    const spy = (e: KeyboardEvent): void => { if (e.key !== 'Escape') others += 1; };
    document.addEventListener('keydown', spy, { capture: true });
    try {
      render(<SuggestCombobox value="" onChange={vi.fn()} options={cities} label="City" />);
      const input = screen.getByRole('combobox', { name: 'City' });
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(others).toBe(1);
      expect(layer.seen()).toBe(0);
    } finally {
      document.removeEventListener('keydown', spy, { capture: true });
      layer.stop();
    }
  });
});

describe('SuggestCombobox — the open list is brought into view', () => {
  const cities = ['Kampala', 'Kigali', 'Kisumu'];

  /** The listbox is `absolute` inside whatever scroll container encloses the field, so when the
   *  field sits near that container's bottom edge the list renders past it and is clipped.
   *  Measured in the facility import sheet on `country`'s 249 options: a 256px list clipped by
   *  231px at 375x812, and by 260px on desktop — the whole list below the fold. */
  it('⛔ scrolls the listbox into view when it opens', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<SuggestCombobox value="" onChange={vi.fn()} options={cities} label="City" />);
      fireEvent.focus(screen.getByRole('combobox', { name: 'City' }));
      expect(scrollIntoView).toHaveBeenCalled();
      // 'nearest' so a list already fully visible does not jump.
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not scroll anything while the list is closed', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<SuggestCombobox value="" onChange={vi.fn()} options={cities} label="City" />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
