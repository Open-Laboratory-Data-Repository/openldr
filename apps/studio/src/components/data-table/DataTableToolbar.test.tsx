import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@/i18n"; // side-effect: initialise i18next so useTranslation() resolves
import { DataTableToolbar } from "./DataTableToolbar";
import type { ColumnDef } from "./types";

const columns: ColumnDef<{ name: string }>[] = [
  { id: "name", labelKey: "users.name", type: "text", accessor: (r) => r.name, defaultVisible: true },
];

const noop = () => {};

describe("DataTableToolbar", () => {
  it("renders Filter, Sort, Columns buttons and a search box", () => {
    render(
      <DataTableToolbar
        columns={columns}
        filters={[]}
        onFiltersChange={noop}
        sorts={[]}
        onSortsChange={noop}
        visibleIds={["name"]}
        onVisibleIdsChange={noop}
        onResetColumns={noop}
        onResetAll={noop}
        searchValue=""
        onSearchChange={noop}
        searchPlaceholder="Search"
      />,
    );

    expect(screen.getByPlaceholderText("Search")).toBeTruthy();
    expect(screen.getByText(/filter/i)).toBeTruthy();
    expect(screen.getByText(/sort/i)).toBeTruthy();
    expect(screen.getByText(/columns/i)).toBeTruthy();
  });

  it("fires onSearchChange when the user types in the search box", () => {
    const onSearchChange = vi.fn();
    render(
      <DataTableToolbar
        columns={columns}
        filters={[]}
        onFiltersChange={noop}
        sorts={[]}
        onSortsChange={noop}
        visibleIds={["name"]}
        onVisibleIdsChange={noop}
        onResetColumns={noop}
        onResetAll={noop}
        searchValue=""
        onSearchChange={onSearchChange}
        searchPlaceholder="Search"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "alice" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("alice");
  });

  // ⛔ Requested by the operator on 2026-08-21, from a phone. The toolbar was one `flex-wrap` row,
  // so a narrow screen broke it wherever it happened to run out of width: search + Filter on the
  // first line, Sort + Columns on the second, and the ⋯ stranded at the end. Now the split is
  // deliberate — search and ⋯ on one row, the three popovers on the next — and `sm:contents`
  // collapses it back to the single desktop line it has always been.
  //
  // ⚠ HONEST NON-PROOF: jsdom applies no media queries, so the `sm:` collapse is a class
  // assertion. The STRUCTURE below is real, and structure is what the responsive rules act on.
  describe("two-row layout on narrow screens", () => {
    function renderToolbar() {
      return render(
        <DataTableToolbar
          columns={columns}
          filters={[]}
          onFiltersChange={noop}
          sorts={[]}
          onSortsChange={noop}
          visibleIds={["name"]}
          onVisibleIdsChange={noop}
          onResetColumns={noop}
          onResetAll={noop}
          searchValue=""
          onSearchChange={noop}
          searchPlaceholder="Search"
          actions={<button data-testid="page-actions" type="button">dots</button>}
        />,
      );
    }

    it("puts the search box and the actions on the same row", () => {
      renderToolbar();
      const row = screen.getByTestId("toolbar-search-row");
      expect(row).toContainElement(screen.getByLabelText("Search"));
      expect(row, "the ⋯ belongs beside the search box").toContainElement(screen.getByTestId("page-actions"));
    });

    it("keeps Filter, Sort and Columns together on the next row", () => {
      renderToolbar();
      const row = screen.getByTestId("toolbar-controls-row");
      for (const name of [/^filter$/i, /^sort$/i, /^columns$/i]) {
        expect(row).toContainElement(screen.getByRole("button", { name }));
      }
      expect(row, "and away from the search box").not.toContainElement(screen.getByLabelText("Search"));
      expect(row.className, "collapsing back to one line on desktop").toMatch(/sm:contents/);
    });

    // ⛔ Rendering `actions` twice is the obvious way to build a responsive layout and it breaks
    // every page: the testids and aria-labels these menus carry would each match two nodes.
    it("renders the caller's actions exactly once", () => {
      renderToolbar();
      expect(screen.getAllByTestId("page-actions")).toHaveLength(1);
    });
  });
});
