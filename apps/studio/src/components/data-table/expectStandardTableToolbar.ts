import { expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

/**
 * Assert a page adopted the full standard table toolbar.
 *
 * ActiveFilterChips is a sibling of DataTableToolbar, not part of it, so a page can render the
 * toolbar and silently omit the chips row. This helper is the guard against that: every page
 * test calls it. Chips only render when a filter is set, so the caller must set one first.
 */
export function expectStandardTableToolbar(): void {
  expect(screen.getByRole("button", { name: /filter/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /sort/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /columns/i })).toBeInTheDocument();

  const clearAll = screen.queryByText(/clear all/i);
  if (!clearAll) {
    throw new Error(
      "ActiveFilterChips is missing. Render <ActiveFilterChips …/> next to <DataTableToolbar/>, " +
        "and set a filter before calling this helper (chips do not render when no filter is set).",
    );
  }
}

/**
 * Add one filter rule through the Filter popover, exactly as a user would.
 *
 * FilterPopover seeds a new rule with the first filterable column and that type's first valid
 * operator (`FilterPopover.tsx:141-149`), so the caller only supplies the value. Apply closes the
 * popover and lifts the rule to the page, which is what makes the chips row appear.
 */
export async function addFilterViaPopover(value: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /^filter$/i }));
  fireEvent.click(await screen.findByRole("button", { name: /add filter/i }));
  fireEvent.change(await screen.findByLabelText(/enter value/i), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
}
