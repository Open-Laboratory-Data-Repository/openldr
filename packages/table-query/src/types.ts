export type FilterOperator =
  | "eq" | "ne" | "like" | "gt" | "gte" | "lt" | "lte"
  | "between" | "in" | "is_null" | "is_not_null";

export type FilterCombine = "and" | "or";

export interface FilterRule {
  /** Client-side unique id for React keys. Never sent to the server. */
  id: string;
  column: string;
  operator: FilterOperator;
  value: string | [string, string] | string[];
  combine: FilterCombine;
}

export interface SortRule {
  id: string;
  column: string;
  ascending: boolean;
}

export type ColumnType = "text" | "number" | "date" | "enum";
