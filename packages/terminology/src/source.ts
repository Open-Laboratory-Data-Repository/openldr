import type { ConceptRecord, ConceptQuery, ExpandedConcept, MapElement, TranslateQuery } from '@openldr/db';
import type { ValueSet } from '@openldr/fhir';

export interface ConceptSource {
  getConcept(system: string, code: string): Promise<ConceptRecord | null>;
  findConcepts(q: ConceptQuery): Promise<ConceptRecord[]>;
  countConcepts(q: Omit<ConceptQuery, 'limit' | 'offset'>): Promise<number>;
  getResourceByUrl(url: string): Promise<unknown | null>;
  translate(q: TranslateQuery): Promise<MapElement[]>;
  /**
   * The codes stored for a value set in `valueset_expansions`, read as they are. `expand` uses them
   * only when the compose finds no concepts, which is the case for the bundled FHIR catalog: its
   * code systems are not loaded as concepts, and its codes came with the catalog.
   */
  storedExpansion?(url: string): Promise<ExpandedConcept[]>;
}

export function valueSetOf(resource: unknown): ValueSet | null {
  const r = resource as { resourceType?: string } | null;
  return r && r.resourceType === 'ValueSet' ? (r as ValueSet) : null;
}
