// The changelog is generated from git history by scripts/make-changelog.ts, which writes
// changelog.json for the page to read. Nothing here runs git or the network: the script does
// that once, and the committed JSON keeps the build offline-safe and deterministic.

/** One commit as `git log` hands it over, already split on the field separator. */
export interface RawCommit {
  hash: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  subject: string;
}

/** A release tag and the date it points at, newest first. */
export interface ReleaseTag {
  name: string;
  date: string;
}

export interface ChangelogEntry {
  hash: string;
  /** `feat`, `fix` or `perf`. */
  type: ChangelogType;
  /** The conventional-commit scope, e.g. `web`. Empty when the commit had none. */
  scope: string;
  /** The subject with the `type(scope):` prefix removed, first letter capitalised. */
  title: string;
}

export interface ChangelogDay {
  date: string;
  /** The release this day shipped under, when a tag covers it. */
  version: string | null;
  entries: ChangelogEntry[];
}

export type ChangelogType = 'feat' | 'fix' | 'perf';

// Only these reach the page. A reader wants what changed in the product, not that a test was
// renamed — docs, chore, test, refactor, style, build and ci commits are dropped on purpose.
const PUBLISHED_TYPES: ChangelogType[] = ['feat', 'fix', 'perf'];

const SUBJECT_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?!?:\s*(?<title>.+)$/;

export const CHANGELOG_TYPE_LABELS: Record<ChangelogType, string> = {
  feat: 'New',
  fix: 'Fixed',
  perf: 'Faster',
};

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** Returns null for a commit that should not appear: a merge, a revert, or an unpublished type. */
export function parseCommit(commit: RawCommit): ChangelogEntry | null {
  const match = SUBJECT_RE.exec(commit.subject.trim());
  if (!match?.groups) return null;

  const type = match.groups.type as ChangelogType;
  if (!PUBLISHED_TYPES.includes(type)) return null;

  const title = match.groups.title.trim();
  if (title.length === 0) return null;

  return { hash: commit.hash, type, scope: match.groups.scope?.trim() ?? '', title: capitalise(title) };
}

/**
 * The version a day shipped under: the oldest tag that is not older than the day. A commit made
 * before any tag exists has no version yet, which is the honest answer — it is unreleased.
 */
export function versionForDate(date: string, tags: ReleaseTag[]): string | null {
  const covering = tags.filter((tag) => tag.date >= date).sort((a, b) => a.date.localeCompare(b.date));
  return covering[0]?.name ?? null;
}

/** Groups commits into days, newest first, dropping days whose commits were all filtered out. */
export function buildChangelog(commits: RawCommit[], tags: ReleaseTag[] = []): ChangelogDay[] {
  const byDate = new Map<string, ChangelogEntry[]>();

  for (const commit of commits) {
    const entry = parseCommit(commit);
    if (!entry) continue;
    const day = byDate.get(commit.date);
    if (day) day.push(entry);
    else byDate.set(commit.date, [entry]);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => ({ date, version: versionForDate(date, tags), entries }));
}

// Reading order, not commit order: what is new matters more than what was repaired.
const TYPE_ORDER: ChangelogType[] = ['feat', 'fix', 'perf'];

/** How many entries a day shows before the rest go behind "show more". */
export const DAY_ENTRY_LIMIT = 8;

/** A day's entries in reading order, so a cap keeps the new work rather than whatever came first. */
export function orderEntries(entries: ChangelogEntry[]): ChangelogEntry[] {
  return TYPE_ORDER.flatMap((type) => entries.filter((entry) => entry.type === type));
}

/** Groups entries under their type label, dropping types the list does not contain. */
export function groupByType(entries: ChangelogEntry[]): Array<{ type: ChangelogType; entries: ChangelogEntry[] }> {
  return TYPE_ORDER.map((type) => ({ type, entries: entries.filter((entry) => entry.type === type) })).filter(
    (group) => group.entries.length > 0,
  );
}

/** `2026-08-12` -> `AUGUST 12, 2026`. Built from the parts so no timezone can shift the day. */
export function formatChangelogDate(date: string): string {
  const months = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ];
  const [year, month, day] = date.split('-');
  const name = months[Number(month) - 1];
  if (!name || !year || !day) return date;
  return `${name} ${Number(day)}, ${year}`;
}
