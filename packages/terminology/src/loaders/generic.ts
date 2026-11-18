import { validateResource } from '@openldr/fhir';
import { OpenLdrError } from '@openldr/core';
import type { ConceptRecord, MapElement, CodingSystemOrigin } from '@openldr/db';

export interface SavedRef { resourceType: string; id: string }

export interface LoaderStore {
  upsertConcepts(rows: ConceptRecord[]): Promise<void>;
  upsertMapElements(rows: MapElement[]): Promise<void>;
  saveResource(resource: unknown): Promise<SavedRef>;
  saveSystem(url: string, version: string | null, kind: string, resourceId: string, meta?: SystemMeta): Promise<void>;
  /** Sync S3: signal that a code system's concepts finished importing. Loaders live outside @openldr/db
   *  and hold only a LoaderStore (no db handle), so they cannot call markTerminologyChanged directly;
   *  the bootstrap-built store wires this to markTerminologyChanged(db, systemUrl). Call ONCE per system
   *  at loader completion (after all concept batches land) — NOT per upsertConcepts batch. */
  markSystemChanged(systemUrl: string): Promise<void>;
}

/** What the resource says about itself, and where the import came from. */
export interface SystemMeta {
  name?: string;
  description?: string;
  origin?: CodingSystemOrigin;
  originRef?: string;
}

/** Who is importing: CE's own seed, an admin, or a content pack. */
export interface ImportOrigin { origin: CodingSystemOrigin; originRef?: string }

export interface LoadResult { system: string; conceptsLoaded: number; resourceUrl: string }

type TerminologyResource = {
  resourceType: string;
  url?: string;
  name?: string;
  title?: string;
  description?: string;
  concept?: { code: string; display?: string; property?: ConceptProperty[] }[];
  group?: { source?: string; target?: string; element: { code: string; target?: { code: string; equivalence?: string }[] }[] }[];
};

/** A FHIR CodeSystem concept property. One `value[x]` is set. */
type ConceptProperty = {
  code: string;
  valueCode?: string; valueString?: string; valueInteger?: number; valueDecimal?: number; valueBoolean?: boolean;
};

/** A concept's FHIR properties as the stored `properties` object, keyed by property code. A
 *  property with no value is left out. No properties gives null, as before. */
export function conceptProperties(props: ConceptProperty[] | undefined): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const p of props ?? []) {
    if (!p || typeof p.code !== 'string' || !p.code) continue;
    const v = p.valueCode ?? p.valueString ?? p.valueInteger ?? p.valueDecimal ?? p.valueBoolean;
    if (v !== undefined) out[p.code] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The checks `importTerminologyResource` runs before it writes anything. Throws `OpenLdrError`. */
export function checkTerminologyResource(json: unknown): TerminologyResource & { url: string } {
  const v = validateResource(json);
  if (!v.ok) throw new OpenLdrError('invalid terminology resource');
  const res = v.resource as TerminologyResource;
  if (!res.url) throw new OpenLdrError('terminology resource requires a url');
  return res as TerminologyResource & { url: string };
}

export async function importTerminologyResource(json: unknown, store: LoaderStore, from?: ImportOrigin): Promise<LoadResult> {
  const res = checkTerminologyResource(json);
  const ref = await store.saveResource(res);
  const meta: SystemMeta = {};
  const name = res.title ?? res.name;
  if (name) meta.name = name;
  if (res.description) meta.description = res.description;
  if (from) {
    meta.origin = from.origin;
    if (from.originRef) meta.originRef = from.originRef;
  }
  await store.saveSystem(res.url, null, res.resourceType, ref.id, meta);
  let conceptsLoaded = 0;
  if (res.resourceType === 'CodeSystem' && res.concept) {
    const rows: ConceptRecord[] = res.concept.map((c) => ({
      system: res.url!,
      code: c.code,
      display: c.display ?? null,
      status: null,
      properties: conceptProperties(c.property),
    }));
    await store.upsertConcepts(rows);
    conceptsLoaded = rows.length;
    // Sync S3: one signal for this CodeSystem import (after all concepts land). The ConceptMap branch
    // below does NOT mark here — upsertMapElements emits the concept_map signal itself.
    await store.markSystemChanged(res.url);
  }
  if (res.resourceType === 'ConceptMap' && res.group) {
    const els: MapElement[] = [];
    for (const g of res.group) {
      for (const e of g.element) {
        for (const t of e.target ?? []) {
          els.push({
            mapUrl: res.url!,
            sourceSystem: g.source ?? '',
            sourceCode: e.code,
            targetSystem: g.target ?? '',
            targetCode: t.code,
            equivalence: t.equivalence ?? null,
          });
        }
      }
    }
    await store.upsertMapElements(els);
  }
  return { system: res.url, conceptsLoaded, resourceUrl: res.url };
}
