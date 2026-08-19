import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@/i18n"; // side-effect: initialise i18next so useTranslation() resolves
import { FilterPopover } from "./FilterPopover";
import type { ColumnDef, FilterRule } from "./types";

// Two columns whose declared `operators` lists diverge from validOperators(type) AT INDEX 0.
// That divergence is what makes a regression at any of the three FilterPopover.tsx call sites
// (194: render an existing rule's operator list, 144: seed a new rule's operator, 226: re-pick
// the operator on column switch) observable — if index 0 matched in both lists, reverting a
// site to validOperators(type) would still produce the same seeded/selected value.
type Row = { id: string; status: string };

const colA: ColumnDef<Row> = {
  id: "id",
  labelKey: "users.username", // "Username"
  accessor: (r) => r.id,
  type: "text",
  operators: ["like", "eq"], // validOperators("text")[0] is "eq" — this starts with "like" instead.
  defaultVisible: true,
};

const colB: ColumnDef<Row> = {
  id: "status",
  labelKey: "users.status", // "Status"
  accessor: (r) => r.status,
  type: "enum",
  operators: ["ne", "in"], // validOperators("enum")[0] is "eq" — this starts with "ne" instead.
  defaultVisible: true,
};

const columns: ColumnDef<Row>[] = [colA, colB];

describe("FilterPopover", () => {
  it("renders only a rule's declared operators, not its column type's full list", async () => {
    // site: FilterPopover.tsx:194 — `const ops = col.operators ?? validOperators(col.type);`
    const filters: FilterRule[] = [
      { id: "f1", column: "id", operator: "like", value: "", combine: "and" },
    ];
    render(<FilterPopover columns={columns} filters={filters} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^filter( \d+)?$/i }));
    await screen.findByRole("button", { name: /add filter/i }); // wait for popover content to mount

    fireEvent.click(screen.getByRole("combobox", { name: /operator/i }));
    // "In list" is valid for text via validOperators("text") but NOT declared on colA.operators.
    expect(screen.queryByRole("option", { name: "In list" })).toBeNull();
    expect(screen.getByRole("option", { name: "Contains" })).toBeInTheDocument();
  });

  it("seeds a new rule's operator from the column's declared list, not validOperators(type)", async () => {
    // site: FilterPopover.tsx:144 — `const ops = col.operators ?? validOperators(col.type);` (addFilter)
    render(<FilterPopover columns={columns} filters={[]} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^filter( \d+)?$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /add filter/i }));

    fireEvent.click(screen.getByRole("combobox", { name: /operator/i }));
    // colA.operators = ["like", "eq"] -> the seeded operator must be "like" ("Contains"), not
    // validOperators("text")[0] = "eq" ("Equals").
    expect(screen.getByRole("option", { name: "Contains" }).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("option", { name: "Equals" }).getAttribute("data-state")).toBe("unchecked");
  });

  it("re-picks the operator from the new column's declared list when the rule's column changes", async () => {
    // site: FilterPopover.tsx:226 — `const nextOps = next.operators ?? validOperators(next.type);`
    const filters: FilterRule[] = [
      { id: "f1", column: "id", operator: "like", value: "", combine: "and" },
    ];
    render(<FilterPopover columns={columns} filters={filters} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^filter( \d+)?$/i }));
    await screen.findByRole("button", { name: /add filter/i }); // wait for popover content to mount

    fireEvent.click(screen.getByRole("combobox", { name: /columns/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Status" }));

    fireEvent.click(screen.getByRole("combobox", { name: /operator/i }));
    // rule.operator ("like") is not in colB.operators (["ne", "in"]), so it must be re-picked
    // from colB.operators[0] = "ne" ("Not equals"), not validOperators("enum")[0] = "eq".
    expect(screen.getByRole("option", { name: "Not equals" }).getAttribute("data-state")).toBe("checked");
    expect(screen.queryByRole("option", { name: "Equals" })).toBeNull();
  });
});
