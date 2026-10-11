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

// `docker run` flags that take a value in the next token. A flag written `--name=x` carries its value.
const RUN_FLAGS_WITH_VALUE = new Set([
  '-v', '--volume', '-e', '--env', '--env-file', '--name', '-p', '--publish', '-w', '--workdir',
  '-u', '--user', '--network', '--net', '--entrypoint', '-l', '--label', '--platform', '--mount',
  '--add-host', '--cap-add', '--cap-drop', '--restart', '--hostname', '-h', '--memory', '-m',
]);

/** The image after each `docker run` in a shell or PowerShell script: the first token that is not
 *  a flag or a flag's value. Line continuations (`\` and a PowerShell backtick) are joined first,
 *  and comment lines are skipped. */
function scriptImageRefs(text: string): string[] {
  const joined = text.replace(/[\\`][ \t]*\r?\n/g, ' ');
  const refs: string[] = [];
  for (const line of joined.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    for (const m of line.matchAll(/\bdocker\s+run\s+([^\n]*)/g)) {
      const tokens = m[1]!.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (!tok.startsWith('-')) {
          refs.push(tok.replace(/^["']|["']$/g, '').replace(/[)"']+$/, ''));
          break;
        }
        if (RUN_FLAGS_WITH_VALUE.has(tok)) i += 1;
      }
    }
  }
  return refs;
}

/** Image references in a compose file (`image:` lines), a Dockerfile (`FROM` lines) or a script
 *  (`docker run` lines). A FROM that names an earlier `AS` stage is not an image and is skipped. */
export function imageRefs(text: string, kind: 'compose' | 'dockerfile' | 'script'): string[] {
  if (kind === 'script') return scriptImageRefs(text);
  const refs: string[] = [];
  if (kind === 'compose') {
    for (const m of text.matchAll(/^\s*(?:-\s*)?image:\s*["']?([^"'\s#]+)["']?/gm)) refs.push(m[1]!);
    return refs;
  }
  const stages = new Set<string>();
  for (const m of text.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/gim)) {
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
