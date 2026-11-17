import { listMapTargets, mapTargetById, mapSynonyms, suggest, type MapTarget, type MapTargetPack } from '@openldr/forms';
import { LOCAL_MAP_URL } from '@openldr/db';
import type { RunMapToFhirInput, RunMapToFhirOutput } from '@openldr/workflows';
import { createMapToFhirCallCache, type MapToFhirCallCache } from './map-to-fhir-service';

/**
 * What the mapping sheet and the CLI call for Map to FHIR: the targets, suggestions, a test run and
 * the code lists. One copy, so the route and the CLI run the same code. It stores nothing, logs
 * nothing and writes no audit row.
 */

/** The most items one test run takes. The route and the CLI both read this. */
export const MAP_TEST_MAX_ITEMS = 20;

/** A fault in the config the caller sent. Its message names config only, never an item value. */
export class MapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapConfigError';
  }
}

export interface MapSuggestionResult { targetPath: string; field: string; score: number }

export type MapTestResult =
  | { ok: true; kind: 'fhir' | 'form' | 'mapped'; resourceTypes: string[]; resources: unknown[] }
  | { ok: false; reason: string; field?: string };

export interface MapTestInput {
  config: { targetId: string; formIds: string[]; mappings: unknown[] };
  items: Record<string, unknown>[];
}

export interface MapToFhirApi {
  targets(locale?: string): Promise<MapTarget[]>;
  /** Null for an unknown target. */
  suggest(input: { targetId: string; fieldNames: string[]; locale?: string }): Promise<MapSuggestionResult[] | null>;
  /** One result per item, in item order. Throws MapConfigError for a config fault. */
  test(input: MapTestInput): Promise<MapTestResult[]>;
  /**
   * The lab's own map comes first with `local: true` and an empty name; the caller words it. Its
   * `sourceSystems` are the distinct source systems of its rows; another map's list is empty.
   */
  codeLists(): Promise<{ url: string; name: string; local: boolean; sourceSystems: string[] }[]>;
}

export interface MapToFhirApiDeps {
  /** The service. `cache` lets one Test call read the packs and forms once for all its rows. */
  mapToFhir(input: RunMapToFhirInput, cache?: MapToFhirCallCache): Promise<RunMapToFhirOutput>;
  packs(): Promise<MapTargetPack[]>;
  /** Stored ConceptMap resources. */
  conceptMaps(): Promise<{ url?: string; name?: string; title?: string }[]>;
  /** The distinct source systems of the lab's own map's rows. */
  localSourceSystems(): Promise<string[]>;
}

// The service starts every config fault message with this text.
const CONFIG_FAULT_PREFIX = 'Map to FHIR node config:';

function kindOf(meta: RunMapToFhirOutput['meta']): 'fhir' | 'form' | 'mapped' {
  if (meta.fhir > 0) return 'fhir';
  if (meta.form > 0) return 'form';
  return 'mapped';
}

export function createMapToFhirApi(deps: MapToFhirApiDeps): MapToFhirApi {
  async function testOne(config: MapTestInput['config'], item: Record<string, unknown>, cache: MapToFhirCallCache): Promise<MapTestResult> {
    let out: RunMapToFhirOutput;
    try {
      out = await deps.mapToFhir({ items: [{ json: item }], config }, cache);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(CONFIG_FAULT_PREFIX)) throw new MapConfigError(err.message);
      throw err;
    }
    const held = out.held[0]?.json as { reason?: unknown; field?: unknown } | undefined;
    if (held) {
      const reason = typeof held.reason === 'string' ? held.reason : 'held';
      return typeof held.field === 'string' ? { ok: false, reason, field: held.field } : { ok: false, reason };
    }
    const resources = out.out.map((i) => i.json);
    const resourceTypes = resources.map((r) => String((r as { resourceType?: unknown }).resourceType ?? ''));
    return { ok: true, kind: kindOf(out.meta), resourceTypes, resources };
  }

  return {
    async targets(locale) {
      return listMapTargets(await deps.packs(), locale ?? 'en');
    },
    async suggest({ targetId, fieldNames, locale }) {
      const target = mapTargetById(await deps.packs(), targetId, locale ?? 'en');
      if (!target) return null;
      return suggest(target, fieldNames, mapSynonyms(locale ?? 'en')).map((s) => ({ targetPath: s.targetPath, field: s.field, score: s.score }));
    },
    async test({ config, items }) {
      const results: MapTestResult[] = [];
      const cache = createMapToFhirCallCache();
      for (const item of items) results.push(await testOne(config, item, cache));
      return results;
    },
    async codeLists() {
      const stored = (await deps.conceptMaps())
        .filter((m): m is { url: string; name?: string; title?: string } => typeof m.url === 'string' && m.url !== '' && m.url !== LOCAL_MAP_URL)
        .map((m) => ({ url: m.url, name: m.name || m.title || m.url, local: false, sourceSystems: [] as string[] }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
      return [{ url: LOCAL_MAP_URL, name: '', local: true, sourceSystems: await deps.localSourceSystems() }, ...stored];
    },
  };
}
