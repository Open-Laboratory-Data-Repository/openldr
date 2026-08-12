import { useState } from 'react';
import {
  CHANGELOG_TYPE_LABELS,
  DAY_ENTRY_LIMIT,
  formatChangelogDate,
  groupByType,
  orderEntries,
  type ChangelogDay,
} from '@/landing/changelog-model';
import changelog from '@/landing/changelog.json';

function DayBlock({ day }: { day: ChangelogDay }) {
  const [expanded, setExpanded] = useState(false);
  const ordered = orderEntries(day.entries);
  const hidden = ordered.length - DAY_ENTRY_LIMIT;
  const visible = expanded ? ordered : ordered.slice(0, DAY_ENTRY_LIMIT);
  const label = formatChangelogDate(day.date);

  return (
    <section aria-label={label} className="pt-14 first:pt-0">
      <div className="flex items-center gap-4">
        <h2 className="font-mono text-sm tracking-[0.15em] text-muted-foreground">{label}</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>

      {day.version ? (
        <p className="mt-6 inline-block rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground">
          {day.version}
        </p>
      ) : null}

      {groupByType(visible).map((group) => (
        <div key={group.type} className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
            {CHANGELOG_TYPE_LABELS[group.type]}
          </h3>
          <ul className="mt-3 space-y-2">
            {group.entries.map((entry) => (
              <li key={entry.hash} className="flex gap-3 text-sm leading-7 text-foreground">
                <span aria-hidden="true" className="text-muted-foreground">
                  •
                </span>
                <span>
                  {entry.scope ? (
                    <span className="font-mono text-xs text-muted-foreground">{entry.scope} </span>
                  ) : null}
                  {entry.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-5 font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {expanded ? 'Show less' : `Show ${hidden} more →`}
        </button>
      ) : null}
    </section>
  );
}

export function ChangelogPage() {
  const days = changelog.days as ChangelogDay[];

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-5xl font-semibold tracking-tight">Changelog</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">
        New features and fixes shipped in OpenLDR. Generated from the repository history.
      </p>

      {days.length === 0 ? (
        <p className="mt-14 text-sm text-muted-foreground">Nothing has shipped yet.</p>
      ) : (
        <div className="mt-14">
          {days.map((day) => (
            <DayBlock key={day.date} day={day} />
          ))}
        </div>
      )}
    </div>
  );
}
