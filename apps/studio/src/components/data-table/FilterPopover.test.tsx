import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@/i18n"; // side-effect: initialise i18next so useTranslation() resolves
import { FilterPopover } from "./FilterPopover";
import type { ColumnDef } from "./types";

describe("FilterPopover", () => {
  it("offers only the operators a column declares, not its type's full list", async () => {
    const columns: ColumnDef<{ id: string }>[] = [
      { id: "id", labelKey: "users.username", accessor: (r) => r.id, type: "text",
        operators: ["eq", "in"], defaultVisible: true },
    ];
    render(<FilterPopover columns={columns} filters={[]} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^filter$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /add filter/i }));

    fireEvent.click(screen.getByRole("combobox", { name: /operator/i }));
    // "Contains" is validOperators("text") but NOT in this column's list.
    expect(screen.queryByRole("option", { name: "Contains" })).toBeNull();
    expect(screen.getByRole("option", { name: "Equals" })).toBeInTheDocument();
  });
});
