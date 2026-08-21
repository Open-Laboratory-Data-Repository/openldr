import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { getAvailableArtifact, getInstalledArtifact, type AvailableArtifactDetail, type InstalledArtifactDetail } from '@/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Divider } from '@/components/ui/bleed';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SignatureBadge } from './SignatureBadge';
import { PayloadPreview } from './PayloadPreview';
import { RequirementsChecklist } from './RequirementsChecklist';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { capabilityLine, type CardEntry } from './util';

interface PackageDetailProps {
  entry: CardEntry;
  onBack: () => void;
  onInstall: (entry: CardEntry, capabilities: unknown[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRollback: (id: string, version: string) => void;
  onRemove: (entry: CardEntry) => void;
  onDetach?: (entry: CardEntry) => void;
  onOpenForm?: (formId: string) => void;
  canPublish?: boolean;
  onPublish?: (entry: CardEntry) => void;
}

export function PackageDetail({ entry, onBack, onInstall, onToggleEnabled, onRollback, onRemove, onDetach, onOpenForm, canPublish, onPublish }: PackageDetailProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<AvailableArtifactDetail | InstalledArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState(entry.ref);

  // Reset the selection when navigating to a different package.
  useEffect(() => { setSelectedRef(entry.ref); }, [entry.ref]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    if (selectedRef) {
      // Browse (registry) item: fetch the signed bundle detail.
      void getAvailableArtifact(selectedRef)
        .then((d) => { if (active) setDetail(d); })
        .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    } else if (entry.installed && entry.type === 'plugin') {
      // Installed plugin with no registry ref: read the rich detail from its stored
      // manifest on demand. Failure degrades silently to the entry-level fields.
      void getInstalledArtifact(entry.id)
        .then((d) => { if (active) setDetail(d); })
        .catch(() => { /* keep entry-level fallback */ });
    }
    return () => { active = false; };
  }, [selectedRef, entry.id, entry.installed, entry.type]);

  // The registry LIST endpoint does not carry capabilities (they live only in the signed
  // per-bundle DETAIL). So for a Browse (ref-bearing) item, entry.capabilities is always []
  // and only detail.capabilities is authoritative. We must therefore gate install on detail
  // having loaded — otherwise onInstall would capture the empty list, the consent dialog would
  // read "no permissions", and the server (which requires acknowledged == requested) rejects.
  const capabilities = (detail?.capabilities ?? entry.capabilities) as unknown[];
  const publisher = detail?.publisher ?? entry.publisher;
  const installableType = entry.type === 'plugin' || entry.type === 'form-template';
  // For registry items, detail must be loaded so the acknowledged capabilities are the real,
  // signed set. Installed/local items (no ref) carry their capabilities on the entry already.
  const detailReadyForInstall = entry.ref ? detail !== null : true;
  const canInstall =
    Boolean(entry.ref) && !entry.installed && installableType && detailReadyForInstall && (detail ? detail.valid : entry.valid !== false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ⛔ No standalone Back row. It had a button, a divider and their padding to itself — about
          50px off the top of every phone screen for one control. Back is the first item in the ⋯
          menu now, which is also where AGENTS.md section 5 puts everything else on this page. */}
      {/* Title row — a fixed header above the scrollable body */}
      <div className="flex items-start justify-between gap-4 py-4">
          <div>
            <h1 className="text-xl font-medium text-foreground">{entry.id}</h1>
            {/* `flex-wrap`: on a phone the publisher name already takes two lines, and without this
                the badges squeeze it further instead of dropping below. */}
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{(publisher?.name || '—')} · v{entry.version}</span>
              <Badge variant="outline" className="text-[10px] uppercase">{entry.type}</Badge>
              {entry.ref ? <SignatureBadge valid={detail ? detail.valid : entry.valid} invalidReason={detail ? detail.invalidReason : entry.invalidReason} publisher={publisher} /> : null}
              {entry.drifted ? <Badge variant="outline" className="border-amber-500 text-amber-700">{t('settings.marketplace.modifiedLocally')}</Badge> : null}
            </p>
          </div>
          {/* ⛔ ONE ⋯ menu, carrying every action. AGENTS.md section 5: page-header actions go in a
              MoreHorizontal DropdownMenu, never a standalone button, and "never a standalone
              Create/New button" is exactly what Install and Publish were. The menu already existed
              here for an installed package; the rest have joined it instead of sitting beside it.
              Ref: pages/settings/Connectors.tsx, whose "Add connector" lives the same way.
              ⚠ The testids stay on the ITEMS, so a test opens the menu and clicks the same id. */}
          <div className="flex shrink-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="detail-menu" aria-label={t('settings.marketplace.details')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* First, and separated: it navigates away rather than acting on this package. */}
                <DropdownMenuItem data-testid="detail-back" onSelect={onBack}>
                  {t('settings.marketplace.back')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {canPublish && entry.ref ? (
                  <DropdownMenuItem data-testid="detail-publish" onSelect={() => onPublish?.(entry)}>
                    {t('settings.marketplace.publish')}
                  </DropdownMenuItem>
                ) : null}
                {canInstall ? (
                  <DropdownMenuItem
                    data-testid="detail-install"
                    disabled={detail ? !detail.compatible : false}
                    onSelect={() => onInstall({ ...entry, ref: selectedRef, version: detail?.version ?? entry.version }, capabilities)}
                  >
                    {t('settings.marketplace.install')}
                  </DropdownMenuItem>
                ) : entry.ref && installableType && !entry.installed && !detailReadyForInstall && (entry.valid !== false) ? (
                  // Detail (the authoritative capability set) is still loading — a disabled item
                  // rather than nothing, so the control does not flicker in.
                  <DropdownMenuItem data-testid="detail-install" disabled>
                    {t('settings.marketplace.install')}
                  </DropdownMenuItem>
                ) : entry.ref && !installableType && !entry.installed ? (
                  <DropdownMenuItem disabled title={t('settings.marketplace.installPluginOnly')}>
                    {t('settings.marketplace.installComingSoon')}
                  </DropdownMenuItem>
                ) : null}
                {entry.installed ? (
                  entry.type === 'form-template' ? (
                    <>
                      {entry.targetFormId ? (
                        <DropdownMenuItem onSelect={() => onOpenForm?.(entry.targetFormId!)}>
                          {t('settings.marketplace.openInBuilder')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className="text-destructive" onSelect={() => onDetach?.(entry)}>
                        {t('settings.marketplace.detach')}
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem onSelect={() => onToggleEnabled(entry.id, !entry.enabled)}>
                        {entry.enabled ? t('settings.marketplace.disable') : t('settings.marketplace.enable')}
                      </DropdownMenuItem>
                      {!entry.active ? (
                        <DropdownMenuItem onSelect={() => onRollback(entry.id, entry.version)}>
                          {t('settings.marketplace.rollback')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className="text-destructive" onSelect={() => onRemove(entry)}>
                        {t('settings.marketplace.remove')}
                      </DropdownMenuItem>
                    </>
                  )
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      <Divider />

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-auto py-4">
        {/* ⛔ Tailwind classes, NOT an inline `gridTemplateColumns`. An inline style carries no media
            query, so the 244px sidebar held its width on every screen — on a 360px phone the main
            column was left about 90px and the description wrapped one or two words a line. One
            column below `md`, the original two from `md` up. */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_244px]" data-testid="detail-body">
          <div className="min-w-0 space-y-4">
            <p className="whitespace-pre-line text-sm text-foreground/85">
              {detail?.description || entry.description || t('settings.marketplace.noDescription')}
            </p>
            {detail?.readme ? (
              <section data-testid="detail-docs">
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.docs')}</p>
                <ReadmeMarkdown content={detail.readme} />
              </section>
            ) : null}
            <PayloadPreview payload={detail?.payload ?? entry.payload ?? null} />
            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            ) : null}
          </div>

          {/* ⚠ `order-first` when stacked. This block is short and factual — publisher, version,
              license, permissions — and the readme above it can run for screens, so on a phone
              anything sitting after it is effectively unreachable. Back in source order from `md`. */}
          <div className="order-first space-y-4 md:order-none" data-testid="detail-side">
            <section className="rounded-md bg-muted/40 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.details')}</p>
              <dl className="space-y-1 text-[13px]">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t('settings.marketplace.publisher')}</dt><dd className="text-right text-foreground/90">{publisher?.name || '—'}</dd></div>
                <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{t('settings.marketplace.version')}</dt><dd className="text-right text-foreground/90">{entry.versions && entry.versions.length > 1 ? (
                  <Select value={selectedRef} onValueChange={setSelectedRef}>
                    <SelectTrigger data-testid="version-select" className="h-7 w-28 text-xs" aria-label={t('settings.marketplace.version')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {entry.versions.map((v) => <SelectItem key={v.ref} value={v.ref}>{v.version}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <span>{entry.version}</span>
                )}</dd></div>
                {(detail?.license ?? entry.license) ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t('settings.marketplace.license')}</dt><dd className="text-right text-foreground/90">{detail?.license ?? entry.license}</dd></div> : null}
              </dl>
            </section>

            <section>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.permissions')}</p>
              {capabilities.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t('settings.marketplace.noneCapabilities')}</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground/85">
                  {capabilities.map((cap, i) => <li key={`${i}-${capabilityLine(cap)}`}>{capabilityLine(cap)}</li>)}
                </ul>
              )}
            </section>

            {detail ? (
              <section>
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.requirements')}</p>
                <RequirementsChecklist compatible={detail.compatible} ceRange={detail.compatibility?.ceVersion ?? '*'} ceVersion={detail.ceVersion} />
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
