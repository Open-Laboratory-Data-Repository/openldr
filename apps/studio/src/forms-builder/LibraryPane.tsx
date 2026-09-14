import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { isKnownFhirResourceType, type FhirPathInfo } from '@openldr/fhir/paths';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { elementDisplayName } from './fhirTypeMap';

/**
 * The right pane: the FHIR elements this form does not bind yet. The field list shows what a form
 * has; this shows what it could still hold, so an author need not make a field before they can
 * look for its path. Ported from corlix `components/form-builder/LibraryPane.tsx`, without the
 * starter-pack group, which S5 adds.
 *
 * Presentation only. The list arrives already filtered by `libraryElements`, and a click hands the
 * element back to the page.
 */
export function LibraryPane({
  resourceType,
  elements,
  showHeader = true,
  fullWidth = false,
  onAddElement,
}: {
  resourceType: string | null;
  elements: FhirPathInfo[];
  /** False when a tab already names the pane, on a narrow workspace. */
  showHeader?: boolean;
  /** True when the pane is the only one on screen, so it takes the width. */
  fullWidth?: boolean;
  onAddElement: (element: FhirPathInfo) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  // Matches the name the row shows, the path, and the R4 label. The label is not on screen, so
  // matching it can only widen the result, never hide a row the reader can see.
  const matching = useMemo(
    () =>
      q
        ? elements.filter(
            (e) =>
              elementDisplayName(e.path).toLowerCase().includes(q) ||
              e.path.toLowerCase().includes(q) ||
              e.label.toLowerCase().includes(q),
          )
        : elements,
    [elements, q],
  );

  return (
    <aside
      className={
        'flex min-h-0 flex-col overflow-hidden ' +
        (fullWidth ? 'min-w-0 flex-1' : 'w-[21rem] shrink-0 border-l border-border')
      }
    >
      {showHeader && (
        <div className="flex h-[38px] shrink-0 items-center border-b border-border px-3">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Library</h2>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2.5">
        {!resourceType ? (
          <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
            Pick a resource type and the library will list what this form could hold.
          </p>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search the library"
                placeholder="Search the library…"
                className="h-8 pl-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5 px-0.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="min-w-0 truncate">{`All ${resourceType} elements`}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px]">{matching.length}</span>
            </div>

            {elements.length === 0 ? (
              <StripedEmpty className="min-h-[8rem] rounded-md">
                {isKnownFhirResourceType(resourceType)
                  ? 'Every element is on the form.'
                  : `The library has no element list for ${resourceType}.`}
              </StripedEmpty>
            ) : (
              <>
                <p className="px-0.5 pb-2 text-xs leading-relaxed text-muted-foreground">
                  {`Everything the FHIR schema defines on ${resourceType}. No pack has an opinion about these.`}
                </p>
                {matching.map((e) => (
                  <Button
                    key={e.path}
                    variant="ghost"
                    onClick={() => onAddElement(e)}
                    className="group mb-0.5 h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left font-normal"
                  >
                    <span className="mt-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground group-hover:border-primary group-hover:text-primary">
                      <Plus className="h-2.5 w-2.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-foreground">{elementDisplayName(e.path)}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{e.path}</span>
                    </span>
                  </Button>
                ))}
                {q && matching.length === 0 && (
                  <p className="px-0.5 pt-1 text-xs text-muted-foreground">
                    {`Nothing in the library matches "${query.trim()}".`}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
