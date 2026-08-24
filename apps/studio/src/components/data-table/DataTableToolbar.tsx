import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { FilterPopover } from "./FilterPopover";
import { SortPopover } from "./SortPopover";
import { ColumnPickerPopover } from "./ColumnPickerPopover";
import type { ColumnDef, FilterRule, SortRule } from "./types";

interface DataTableToolbarProps<T> {
  columns: ColumnDef<T>[];
  filters: FilterRule[];
  onFiltersChange: (filters: FilterRule[]) => void;
  sorts: SortRule[];
  onSortsChange: (sorts: SortRule[]) => void;
  visibleIds: string[];
  onVisibleIdsChange: (ids: string[]) => void;
  onResetColumns: () => void;
  onResetAll: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchEnter?: () => void;
  searchPlaceholder?: string;
  /** Right-aligned page-specific actions (e.g. the "…" dropdown with New / Import). */
  actions?: ReactNode;
}

export function DataTableToolbar<T>({
  columns,
  filters,
  onFiltersChange,
  sorts,
  onSortsChange,
  visibleIds,
  onVisibleIdsChange,
  onResetColumns,
  onResetAll,
  searchValue,
  onSearchChange,
  onSearchEnter,
  searchPlaceholder,
  actions,
}: DataTableToolbarProps<T>) {
  const { t } = useTranslation();
  const hasActiveState = filters.length > 0 || sorts.length > 0;

  // `gap-3` below `sm`: that is exactly where this becomes TWO rows, and 8px between a search
  // box and a row of buttons read as crowded on a phone. Back to `gap-2` from `sm` up, where it
  // is a single line again and the gap is only horizontal.
  return (
    /* ⛔ Two rows on a phone, ONE row from `sm` up.
       It used to be a single `flex-wrap` row, so a narrow screen broke it wherever it ran out of
       width — search + Filter on one line, Sort + Columns on the next, the ⋯ stranded at the end.
       The grid makes the split deliberate: search and ⋯ on top, the three popovers below.
       `sm:contents` then dissolves both wrappers so their children become direct flex items of this
       box, restoring the single desktop line this has always had.
       ⚠ `actions` is rendered ONCE. Duplicating it per breakpoint would double every testid and
       aria-label the page menus carry. */
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:gap-2">
      <div className="contents" data-testid="toolbar-search-row">
        {onSearchChange && (
          <Input
            type="search"
            value={searchValue ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter?.(); }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder ?? t("common.search", { defaultValue: "Search" })}
            className="h-8 w-full min-w-0 text-xs sm:w-60"
          />
        )}
        {/* `order-last` + `ml-auto` put the ⋯ at the far right of the single desktop row, which is
            where it sat before. On the phone grid it is simply the second column of row one.

            ⛔ Rendered only when the caller HAS actions. An empty wrapper still counts as a flex
            item, so `gap-2` applied on both sides of it and a caller that puts its own control
            beside the toolbar got a double gap there (16px against 8px everywhere else) with
            nothing in between. Facilities is that caller: its ⋯ is portalled to the tab strip, so
            it passes no `actions` and sits its Mapping health Select next to the toolbar. */}
        {actions && (
          <div className="flex items-center justify-self-end sm:order-last sm:ml-auto">{actions}</div>
        )}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:contents" data-testid="toolbar-controls-row">
        <FilterPopover columns={columns} filters={filters} onApply={onFiltersChange} />
        <SortPopover columns={columns} sorts={sorts} onApply={onSortsChange} />
        <ColumnPickerPopover
          columns={columns}
          visibleIds={visibleIds}
          onChange={onVisibleIdsChange}
          onResetDefaults={onResetColumns}
        />
        {hasActiveState && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={onResetAll}
          >
            {t("table.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}
