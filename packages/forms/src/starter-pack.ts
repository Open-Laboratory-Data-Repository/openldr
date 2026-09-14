import type { FieldDiscriminator, FieldType } from './schema/form-schema';

/**
 * A starter pack: the fields OpenLDR's own form collects for one resource type, offered when an
 * author starts a form. The FHIR schema lists every element and ranks none; a pack is the opinion.
 * Ported from corlix `@corlix/shared-types` `StarterPack`. Read-only: neither app edits packs.
 */
export interface StarterPack {
  id: string;
  resourceType: string;
  name: string;
  version: string;
  seeded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StarterPackEntry {
  /** Position in the pack, from 0. With the pack id, the entry's identity. */
  ord: number;
  /** Resource-prefixed. Null for a field the form saves by API property only. */
  fhirPath: string | null;
  label: string;
  apiProperty: string | null;
  /** Null lets the studio fall back to text. */
  fieldType: FieldType | null;
  fhirValueField: string | null;
  required: boolean;
  /** Checked and cannot be unchecked: a page the form feeds cannot save a record without it. */
  locked: boolean;
  /** Checked when the chooser opens. */
  defaultOn: boolean;
  discriminator?: FieldDiscriminator;
  boundValueSet: string | null;
  referenceTarget: string | null;
  referenceMultiple: boolean;
  /** One line, shown in the chooser. */
  rationale: string;
}

export interface StarterPackWithEntries extends StarterPack {
  entries: StarterPackEntry[];
}

/** A pack as the seed writes it. The store adds `seeded` and the timestamps. */
export interface SeededStarterPack {
  id: string;
  resourceType: string;
  name: string;
  version: string;
  entries: StarterPackEntry[];
}
