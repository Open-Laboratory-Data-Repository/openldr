import {
  buildChangelog,
  formatChangelogDate,
  groupByType,
  orderEntries,
  parseCommit,
  versionForDate,
  type ChangelogEntry,
  type RawCommit,
} from './changelog-model';

function commit(subject: string, date = '2026-08-12', hash = 'abc1234'): RawCommit {
  return { hash, date, subject };
}

describe('parseCommit', () => {
  it('reads the type, scope and title out of a conventional subject', () => {
    expect(parseCommit(commit('feat(web): add a changelog page'))).toEqual({
      hash: 'abc1234',
      type: 'feat',
      scope: 'web',
      title: 'Add a changelog page',
    });
  });

  it('keeps a commit that has no scope', () => {
    expect(parseCommit(commit('fix: stop the importer double-counting'))?.scope).toBe('');
  });

  it('reads a breaking-change subject, which marks the type with a bang', () => {
    expect(parseCommit(commit('feat(api)!: drop the v1 route'))?.title).toBe('Drop the v1 route');
  });

  it.each(['docs(web): fix a typo', 'chore: bump deps', 'test(db): add a case', 'refactor(ui): tidy'])(
    'drops %s, which is not product-visible',
    (subject) => {
      expect(parseCommit(commit(subject))).toBeNull();
    },
  );

  it('drops a merge commit, which has no conventional prefix', () => {
    expect(parseCommit(commit('Merge: reports print an unambiguous date'))).toBeNull();
  });

  it('drops a subject whose title is empty', () => {
    expect(parseCommit(commit('feat(web):   '))).toBeNull();
  });
});

describe('versionForDate', () => {
  const tags = [
    { name: 'v0.2.0', date: '2026-09-01' },
    { name: 'v0.1.0', date: '2026-08-01' },
  ];

  it('picks the oldest tag that still covers the day', () => {
    expect(versionForDate('2026-08-15', tags)).toBe('v0.2.0');
  });

  it('picks a tag cut on the same day', () => {
    expect(versionForDate('2026-08-01', tags)).toBe('v0.1.0');
  });

  it('returns null for work newer than every tag, which is unreleased', () => {
    expect(versionForDate('2026-09-20', tags)).toBeNull();
  });

  it('returns null when the repo has no release tags at all', () => {
    expect(versionForDate('2026-08-15', [])).toBeNull();
  });
});

describe('buildChangelog', () => {
  it('groups entries by day, newest day first', () => {
    const days = buildChangelog([
      commit('feat(web): second thing', '2026-08-12'),
      commit('fix(db): older thing', '2026-08-10'),
      commit('feat(web): first thing', '2026-08-12'),
    ]);

    expect(days.map((day) => day.date)).toEqual(['2026-08-12', '2026-08-10']);
    expect(days[0].entries.map((entry) => entry.title)).toEqual(['Second thing', 'First thing']);
  });

  it('omits a day whose commits were all filtered out', () => {
    const days = buildChangelog([
      commit('docs(web): tidy the readme', '2026-08-11'),
      commit('feat(web): a real change', '2026-08-12'),
    ]);

    expect(days.map((day) => day.date)).toEqual(['2026-08-12']);
  });

  it('returns nothing when no commit qualifies', () => {
    expect(buildChangelog([commit('chore: bump deps')])).toEqual([]);
  });

  it('stamps each day with the release covering it', () => {
    const days = buildChangelog([commit('feat(web): a thing', '2026-08-05')], [
      { name: 'v0.1.0', date: '2026-08-09' },
    ]);

    expect(days[0].version).toBe('v0.1.0');
  });
});

describe('orderEntries', () => {
  const entry = (type: ChangelogEntry['type'], title: string): ChangelogEntry => ({
    hash: title,
    type,
    scope: '',
    title,
  });

  it('puts new work first, then fixes, then speed-ups', () => {
    const ordered = orderEntries([entry('perf', 'c'), entry('fix', 'b'), entry('feat', 'a')]);
    expect(ordered.map((item) => item.title)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the original order within a type', () => {
    const ordered = orderEntries([entry('fix', 'first'), entry('fix', 'second')]);
    expect(ordered.map((item) => item.title)).toEqual(['first', 'second']);
  });

  it('means a capped day keeps its new work, not whatever came first', () => {
    const capped = orderEntries([entry('fix', 'a fix'), entry('feat', 'a feature')]).slice(0, 1);
    expect(capped.map((item) => item.title)).toEqual(['a feature']);
  });
});

describe('groupByType', () => {
  const entry = (type: ChangelogEntry['type']): ChangelogEntry => ({ hash: type, type, scope: '', title: type });

  it('omits a type the day does not contain', () => {
    expect(groupByType([entry('feat'), entry('perf')]).map((group) => group.type)).toEqual(['feat', 'perf']);
  });

  it('returns nothing for an empty day', () => {
    expect(groupByType([])).toEqual([]);
  });
});

describe('formatChangelogDate', () => {
  it('spells the month out without going through a timezone', () => {
    expect(formatChangelogDate('2026-08-12')).toBe('AUGUST 12, 2026');
  });

  it('drops a leading zero from the day', () => {
    expect(formatChangelogDate('2026-01-05')).toBe('JANUARY 5, 2026');
  });

  it('hands back anything it cannot read', () => {
    expect(formatChangelogDate('not-a-date')).toBe('not-a-date');
  });
});
