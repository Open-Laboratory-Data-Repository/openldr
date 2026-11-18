/** What a guide needs to show in the docs list: the permissions of the page it documents. */
export interface GuideAccess { requiredCapabilities?: string[] }

/**
 * Whether the docs list shows a guide to a person (design 2026-11-18-roles-scope, part 4). A guide
 * that names no permission shows to everyone; one that names some shows to a person holding any of
 * them. Only the list and search are filtered: a link to a guide still opens it, since a guide holds
 * no data.
 */
export function mayReadGuide(guide: GuideAccess, hasCapability: (cap: string) => boolean): boolean {
  const caps = guide.requiredCapabilities ?? [];
  return caps.length === 0 || caps.some((c) => hasCapability(c));
}
