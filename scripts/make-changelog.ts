// Generates apps/web/src/landing/changelog.json from git history.
//
// The landing site is a static SPA: it cannot run git, and we do not want it fetching anything
// at page load. So this runs once, on demand, and its output is committed. Re-run it before a
// release — `pnpm make:changelog` — and commit the result.
//
// Only feat/fix/perf commits are published; see changelog-model.ts for why.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildChangelog, type RawCommit, type ReleaseTag } from '../apps/web/src/landing/changelog-model';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(repoRoot, 'apps/web/src/landing/changelog.json');

// A field separator that cannot appear in a commit subject, so a subject containing a pipe or a
// tab still parses. %x1f is ASCII unit separator.
const FIELD = '\x1f';
// Enough history to fill the page without carrying every commit the repo will ever have.
const MAX_COMMITS = 400;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function readCommits(): RawCommit[] {
  const log = git([
    'log',
    `--max-count=${MAX_COMMITS}`,
    '--no-merges',
    '--date=short',
    `--pretty=format:%h${FIELD}%ad${FIELD}%s`,
  ]);

  return log
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash, date, subject] = line.split(FIELD);
      return { hash, date, subject: subject ?? '' };
    });
}

// Release tags only. The repo also carries backup/ and checkpoint/ markers, which are not
// releases and must not become version chips.
function readTags(): ReleaseTag[] {
  const out = git(['tag', '--list', 'v*', '--format=%(refname:short)\x1f%(creatordate:short)']);

  return out
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, date] = line.split(FIELD);
      return { name, date };
    });
}

const days = buildChangelog(readCommits(), readTags());
const payload = {
  // Stamped so the page can say how current it is, and so a stale file is obvious in review.
  generatedAt: git(['log', '-1', '--date=short', '--pretty=format:%ad']).trim(),
  days,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const entryCount = days.reduce((total, day) => total + day.entries.length, 0);
console.log(`changelog: ${entryCount} entries across ${days.length} days -> ${OUT}`);
