import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Divider } from '@/components/ui/bleed';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AvailableArtifact, InstalledArtifact } from '@/api';
import { PackageCard } from './PackageCard';
import { PackageDetail } from './PackageDetail';
import { RegistriesTab } from './RegistriesTab';
import { availableToEntry, installedToEntry, type CardEntry } from './util';

interface MarketplaceTabsProps {
  configured: boolean;
  available: AvailableArtifact[];
  installed: InstalledArtifact[];
  onInstall: (entry: CardEntry, capabilities: unknown[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRollback: (id: string, version: string) => void;
  onRemove: (entry: CardEntry) => void;
  onDetach?: (entry: CardEntry) => void;
  onOpenForm?: (formId: string) => void;
  canPublish?: boolean;
  onPublish?: (entry: CardEntry) => void;
  source: 'local' | 'http' | null;
  host: string | null;
  onRefresh: () => void;
  loadError?: string | null;
}

/**
 * The one ⋯ for the whole page, sitting on the tab strip itself.
 *
 * ⛔ Its items follow the ACTIVE TAB. Browse and Installed each used to carry their own ⋯ inside
 * the filter bar, and Registries kept a third inside the shared table toolbar — three menus for one
 * page. AGENTS.md section 5 wants page-header actions in a single MoreHorizontal DropdownMenu, so
 * this is that menu and the other two are gone.
 *
 * ⚠ The testIds are unchanged on purpose (`refresh-registry`, `refresh-installed`, `add-registry`),
 * so the existing tests reach the same items through the new trigger.
 */
function HeaderActions({ tab, onRefresh, onAddRegistry }: {
  tab: string; onRefresh: () => void; onAddRegistry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tab === 'registries' ? (
          <DropdownMenuItem data-testid="add-registry" onSelect={onAddRegistry}>
            <Plus className="mr-2 h-4 w-4" /> {t('settings.marketplace.registryAddBtn')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            data-testid={tab === 'installed' ? 'refresh-installed' : 'refresh-registry'}
            onSelect={onRefresh}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> {t('settings.marketplace.refresh')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search + type filter toolbar, shared by Browse + Installed. The trailing slot that used to hold
 *  the source label and this tab's ⋯ is gone — both live on the tab strip now, which is what frees
 *  this row for the search box and type filter on a phone. */
function FilterBar({ filter, setFilter, typeFilter, setTypeFilter }: {
  filter: string; setFilter: (v: string) => void;
  typeFilter: string; setTypeFilter: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex items-center gap-2">
      {/* `min-w-0`: this is the item that gives up width when the row is tight. Without it the input's
          own intrinsic minimum fights the select for the same pixels. */}
      <Input className="min-w-0 max-w-xs" placeholder={t('settings.marketplace.searchPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('settings.marketplace.searchPlaceholder')} />
      <Select value={typeFilter} onValueChange={setTypeFilter}>
        {/* ⛔ `shrink-0`. `w-36` is a PREFERRED width, not a floor: a flex item shrinks by default, and
            this row wanted 320 + 144 + 8 inside 328 on a phone, so the trigger was squeezed to 101px
            and "All types" wrapped to two lines inside a 36px control.
            ⚠ `truncate` for fr and pt — "Tous les types" and "Todos os tipos" are longer than the
            English, and an ellipsis is the right failure, not a second line. */}
        <SelectTrigger className="w-36 shrink-0 truncate [&>span]:truncate" aria-label={t('settings.marketplace.filterByType', { defaultValue: 'Filter by type' })}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('settings.marketplace.allTypes')}</SelectItem>
          <SelectItem value="plugin">Plugin</SelectItem>
          <SelectItem value="form-template">Form template</SelectItem>
          <SelectItem value="report-template">Report</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function MarketplaceTabs(props: MarketplaceTabsProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState<CardEntry | null>(null);
  const [tab, setTab] = useState('browse');
  /** RegistriesTab owns its create dialog. The ⋯ that opens it now lives up here on the tab strip,
   *  so the child hands its opener up once via `onReady` rather than the parent lifting all of that
   *  dialog state. `bindRegistries` is memoised so the child's effect runs once, not every render. */
  const registriesApi = useRef<{ openCreate: () => void } | null>(null);
  const bindRegistries = useCallback((api: { openCreate: () => void }) => { registriesApi.current = api; }, []);

  const installedById = useMemo(() => new Map(props.installed.map((a) => [a.id, a])), [props.installed]);

  const browseEntries = useMemo(() => props.available
    .filter((b) => {
      const textMatch = !filter || b.id.toLowerCase().includes(filter.toLowerCase()) || b.ref.toLowerCase().includes(filter.toLowerCase());
      const typeMatch = typeFilter === 'all' || b.type === typeFilter;
      return textMatch && typeMatch;
    })
    .map((b) => availableToEntry(b, installedById)), [props.available, filter, typeFilter, installedById]);

  const installedEntries = useMemo(() => props.installed
    .filter((a) => {
      const textMatch = !filter || a.id.toLowerCase().includes(filter.toLowerCase());
      const typeMatch = typeFilter === 'all' || a.type === typeFilter;
      return textMatch && typeMatch;
    })
    .map(installedToEntry), [props.installed, filter, typeFilter]);

  if (selected) {
    return (
      // ⚠ The detail view keeps a `p-4` of its own. It renders <Divider/>, which negative-margins
      // by exactly 4 to reach the pane edges, so it needs a 4 to cancel.
      <div className="flex min-h-0 flex-1 flex-col p-4">
      <PackageDetail
        entry={selected}
        onBack={() => setSelected(null)}
        onInstall={props.onInstall}
        onToggleEnabled={props.onToggleEnabled}
        onRollback={props.onRollback}
        onRemove={props.onRemove}
        onDetach={props.onDetach}
        onOpenForm={props.onOpenForm}
        canPublish={props.canPublish}
        onPublish={props.onPublish}
      />
      </div>
    );
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      {/* The tab strip carries the page's ⋯ and, on Browse, the registry source label. The rule
          bleeds to the pane edges (`-mx-4 px-4`) while the tabs stay inset — AGENTS.md section 5.
          ⚠ The border lives on THIS row, not on TabsList, so it spans the full width instead of
          stopping where the tabs stop. TabsList drops its own border and takes `-mb-px` so the
          active trigger's 2px primary indicator covers the row's 1px line rather than stacking on
          top of it. `overflow-x-auto` keeps the tabs reachable when they outrun a phone; the
          trailing group is `shrink-0` so the ⋯ is never the thing that gets squeezed out. */}
      <div className="flex items-center gap-2 border-b border-border px-4">
        <TabsList className="-mb-px min-w-0 overflow-x-auto border-b-0">
          <TabsTrigger value="browse">{t('settings.marketplace.browse')}</TabsTrigger>
          <TabsTrigger value="installed">{t('settings.marketplace.installedTab')} ({props.installed.length})</TabsTrigger>
          <TabsTrigger value="registries">{t('settings.marketplace.registriesTab')}</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {tab === 'browse' && props.source ? (
            /* ⚠ Hidden below `sm`. The three tabs need 262px and a 360px phone has 288px once the
               padding and the ⋯ are paid for — there is no room left for a label that says anything.
               Showing it anyway squeezed the tab strip to 210px and truncated "Registries" to
               "Registri". The tabs win: this label is informational, and the same source is named on
               every card ("from Local registry"). */
            <span className="hidden max-w-[10rem] truncate text-xs text-muted-foreground sm:inline" data-testid="registry-source">
              {props.source === 'http' ? t('settings.marketplace.sourceRemote', { host: props.host ?? '' }) : t('settings.marketplace.sourceLocal')}
            </span>
          ) : null}
          <HeaderActions
            tab={tab}
            onRefresh={props.onRefresh}
            onAddRegistry={() => registriesApi.current?.openCreate()}
          />
        </div>
      </div>

      <TabsContent value="browse" className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-4">
          <FilterBar filter={filter} setFilter={setFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter} />
        </div>
        {/* `mx-0` cancels Divider's built-in `-mx-4`: it assumes a `p-4` parent, and this row is
            already full width. */}
        <Divider className="mx-0" />
        {/* ⛔ The card list owns a scroll region. `marketplace-page` is `overflow-hidden`, so without
            one a registry holding more bundles than fit was simply CLIPPED and unreachable — measured
            at 360x340 with a single card: panel scrollHeight 202 vs clientHeight 155, zero scrollable
            elements on the page. Same defect as Settings ▸ Laboratory.
            ⚠ The Divider stays ABOVE this box. It bleeds edge-to-edge with negative margins and an
            `overflow-auto` ancestor would clip it (AGENTS.md section 5). */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {props.loadError ? (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
              <p className="text-sm">{t('settings.marketplace.registryUnreachable')}</p>
              {/* ⛔ The server's own message, verbatim. It carries the registry name and, for a local
                  registry, the RESOLVED absolute path — the only thing that reveals a relative location
                  landing somewhere the operator did not expect. Rendering the translated headline alone
                  is what left "Registry unreachable." as the entire diagnosis.
                  ⚠ NOT translated, and no i18n key: it is a server string and a filesystem path.
                  Inventing a key would ship fr and pt with a literal-braces gap. `break-all` because a
                  Windows path has no spaces to wrap on and would otherwise bleed off a phone. */}
              <p className="mt-1 break-all font-mono text-[11px] leading-snug opacity-80">{props.loadError}</p>
            </div>
          ) : null}
          {!props.configured ? (
            <div className="px-1 py-6 text-sm text-muted-foreground">{t('settings.marketplace.notConfigured')}</div>
          ) : browseEntries.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-muted-foreground">{t('settings.marketplace.emptyBrowse')}</div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {browseEntries.map((e) => <PackageCard key={e.ref ?? e.id} entry={e} onClick={() => setSelected(e)} />)}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="installed" className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-4">
          <FilterBar filter={filter} setFilter={setFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter} />
        </div>
        {/* `mx-0` cancels Divider's built-in `-mx-4`: it assumes a `p-4` parent, and this row is
            already full width. */}
        <Divider className="mx-0" />
        {/* ⛔ The card list owns a scroll region. `marketplace-page` is `overflow-hidden`, so without
            one a registry holding more bundles than fit was simply CLIPPED and unreachable — measured
            at 360x340 with a single card: panel scrollHeight 202 vs clientHeight 155, zero scrollable
            elements on the page. Same defect as Settings ▸ Laboratory.
            ⚠ The Divider stays ABOVE this box. It bleeds edge-to-edge with negative margins and an
            `overflow-auto` ancestor would clip it (AGENTS.md section 5). */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {installedEntries.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-muted-foreground">{t('settings.marketplace.emptyInstalled')}</div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {installedEntries.map((e) => <PackageCard key={e.id} entry={e} onClick={() => setSelected(e)} />)}
            </div>
          )}
        </div>
      </TabsContent>

      {/* ⛔ `flex flex-col`, not just `flex-1`. RegistriesTab fills with `flex-1` and its Table with
          `wrapperClassName="min-h-0 flex-1"`, but a fill child needs a FLEX COLUMN parent — in a block
          box `flex-1` is inert and the table stopped short, leaving dead background under the
          pagination row. Same trap as Terminology's tables in the 2026-07-31 mobile pass.
          Safe only because ui/tabs.tsx already ships `data-[state=inactive]:hidden`: a `display`
          utility here ties the UA `[hidden]{display:none}` rule on specificity, and without that guard
          the inactive panel would stay laid out and steal the space back. */}
      <TabsContent value="registries" className="flex min-h-0 flex-1 flex-col">
        <RegistriesTab onChanged={props.onRefresh} onReady={bindRegistries} />
      </TabsContent>
    </Tabs>
  );
}
