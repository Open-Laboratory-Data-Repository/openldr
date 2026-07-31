import type { AppContext } from '@openldr/bootstrap';

/**
 * Resolve a coding-system identifier to the canonical URL the terminology store keys on.
 *
 * A form field may name its system either way: `resolveReferenceSource` classifies both
 * `cs-url-LOINC` (the coding-system row id) and `http://loinc.org` (the canonical URL) as a
 * codesystem source, and the spec documents that convention. But `terminology_concepts.system`
 * holds the canonical URL only, so passing an id straight through returns zero rows forever
 * with no error.
 *
 * Matching on `id` OR `url` — the same rule `terminology-admin-routes`' `systemInfo` uses —
 * means an already-canonical URL passes through unchanged. An identifier that matches no
 * installed system is returned as-is, so the caller's own "not installed" handling still runs.
 */
export function makeCodingSystemResolver(ctx: AppContext): (system: string) => Promise<string> {
  return async (system: string): Promise<string> => {
    const systems = await ctx.terminology.admin.codingSystems.list();
    const found = systems.find((s) => s.id === system || s.url === system);
    return found?.url ?? system;
  };
}
