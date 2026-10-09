export interface ThirdPartyImage { name: string; upstream: string; copy: string; digest: string }
export interface ThirdPartyList {
  images: ThirdPartyImage[];
  exceptions: { image: string; reason: string }[];
}

const ORG = 'ghcr.io/open-laboratory-data-repository/';
export const OWN_IMAGE_PREFIX = `${ORG}openldr-`;

export function parseThirdPartyList(json: string): ThirdPartyList {
  const raw = JSON.parse(json) as ThirdPartyList;
  for (const img of raw.images) {
    if (!img.copy.startsWith(ORG)) {
      throw new Error(`${img.name}: copy must live under ${ORG}, got ${img.copy}`);
    }
  }
  return { images: raw.images, exceptions: raw.exceptions ?? [] };
}

export function pinnedRef(img: ThirdPartyImage): string {
  return `${img.copy}@${img.digest}`;
}

/** Image references in a compose file (`image:` lines) or a Dockerfile (`FROM` lines). A FROM
 *  that names an earlier `AS` stage is not an image and is skipped. */
export function imageRefs(text: string, kind: 'compose' | 'dockerfile'): string[] {
  const refs: string[] = [];
  if (kind === 'compose') {
    for (const m of text.matchAll(/^\s*image:\s*["']?([^"'\s#]+)["']?/gm)) refs.push(m[1]!);
    return refs;
  }
  const stages = new Set<string>();
  for (const m of text.matchAll(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/gim)) {
    const image = m[1]!;
    if (!stages.has(image.toLowerCase())) refs.push(image);
    if (m[2]) stages.add(m[2].toLowerCase());
  }
  return refs;
}

/** References that break the policy: not ours, not a pinned copy from the list, and not a
 *  listed exception. */
export function badImageRefs(refs: string[], list: ThirdPartyList): string[] {
  const allowed = new Set([
    ...list.images.filter((i) => i.digest !== '').map(pinnedRef),
    ...list.exceptions.map((e) => e.image),
  ]);
  return refs.filter((r) => !r.startsWith(OWN_IMAGE_PREFIX) && !allowed.has(r));
}

export function replaceDigest(text: string, copy: string, oldDigest: string, newDigest: string): string {
  return text.split(`${copy}@${oldDigest}`).join(`${copy}@${newDigest}`);
}
