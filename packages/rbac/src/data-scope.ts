// A user's data limit (design 2026-11-18-roles-scope, part 3). Everything is today's behaviour. A
// limited user sees dashboard numbers only from the listed facilities, districts and regions of the
// facility register. Limited with nothing listed sees nothing.

/** A district, with its region, because district names repeat across regions. */
export interface ScopeDistrict { region: string; district: string }

export type DataScope =
  | { limited: false }
  | { limited: true; facilities: string[]; districts: ScopeDistrict[]; regions: string[] };

export const EVERYTHING: DataScope = { limited: false };
