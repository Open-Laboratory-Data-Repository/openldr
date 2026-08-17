/** Strict MAJOR.MINOR.PATCH, with the optional leading `v` that git tags carry.
 *
 * Prereleases (`1.0.0-rc1`) are deliberately rejected rather than tolerated. The release
 * process publishes only plain versions, and silently dropping a suffix would let `1.0.0-rc1`
 * and `1.0.0` compare equal — which would let a release candidate satisfy the "version was
 * bumped" precondition. */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(input: string): Semver | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Negative when a < b, 0 when equal, positive when a > b.
 *  Throws on unparseable input: a release script must fail loudly, not treat garbage as equal. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa) throw new Error(`not a version: ${a}`);
  if (!pb) throw new Error(`not a version: ${b}`);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/** True only when `candidate` is strictly greater than `current`.
 *  Returns false when either side is unparseable — never announce an update you cannot verify. */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!parseSemver(candidate) || !parseSemver(current)) return false;
  return compareSemver(candidate, current) > 0;
}
