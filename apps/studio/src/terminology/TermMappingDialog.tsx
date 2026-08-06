import { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, Network } from 'lucide-react';
import type { CodingSystem, MapType, OntologyDistribution, TermMapping, TermMappingInput } from '../api';
import { createTermMapping, updateTermMapping } from '../api';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { TermPicker, type PickedTerm } from './TermPicker';
import { OntologyPickerDialog } from './ontology/OntologyPickerDialog';

// ── runtime constants ─────────────────────────────────────────────────────────

const MAP_TYPE_VALUES: readonly MapType[] = [
  'SAME-AS',
  'NARROWER-THAN',
  'BROADER-THAN',
  'RELATED-TO',
  'UNMAPPED-FROM',
] as const;

// ── en.json labels (inlined — no i18n dependency in web) ─────────────────────
// Source: corlix/apps/desktop/src/renderer/i18n/locales/en.json terminology.mapping.*
const L = {
  editTitle: 'Edit mapping',
  newTitle: 'New mapping',
  sectionGeneral: 'General',
  sectionStatus: 'Status',
  target: 'Target',
  mapType: 'Map type',
  mapTypeOptions: {
    'SAME-AS': 'Same as',
    'NARROWER-THAN': 'Narrower than',
    'BROADER-THAN': 'Broader than',
    'RELATED-TO': 'Related to',
    'UNMAPPED-FROM': 'Unmapped from',
  } as Record<MapType, string>,
  relationship: 'Relationship',
  relationshipPlaceholder: 'e.g. equivalent',
  owner: 'Owner',
  ownerPlaceholder: 'e.g. WHO',
  manualSystem: 'System',
  manualCode: 'Code',
  manualDisplay: 'Display',
  manualDisplayPlaceholder: 'Human-readable label',
  manualHint: 'Enter the target code directly.',
  searchPlaceholder: 'Search terms…',
  searchHint: 'Search for a term in the target system.',
  switchToManual: 'Enter manually',
  switchToSearch: 'Search terms',
  isActive: 'Active mapping',
  browseSystem: (name: string) => `Browse ${name}`,
  // Distinct hints for two genuinely different disabled states (Fix 3, mapping-ux report):
  // - `browseBuildingHint`: a distribution IS linked to this system, it just isn't indexed yet
  //   (building, or errored) — accurate to say "available once built".
  // - `browseNeverAvailableHint`: NO distribution is linked at all — a local/synthetic system such
  //   as FACILITY-REGISTRY has no ontology to browse and never will via this dialog. Saying "once
  //   built" here is actively misleading (it implies waiting helps); point at Search instead, which
  //   is the mode that actually works for these systems.
  browseBuildingHint: 'Available once the target system\'s ontology index is built.',
  browseNeverAvailableHint: 'This system has no ontology to browse. Use Search terms instead.',
  // Fix round 2 (mapping-targets report): when `lockedTargetSystem` is set and an existing
  // mapping's stored `toSystem` disagrees with it, saving must never silently rewrite `toSystem` to
  // the locked system. The field instead shows the REAL stored target, flagged, until the operator
  // takes the explicit retarget action below.
  targetMismatchHint: 'This mapping targets a different system than the one expected here. Saving will not change it.',
  retargetAction: (name: string) => `Point at ${name} instead`,
  // common.*
  save: 'Save',
  saving: 'Saving…',
  create: 'Create',
  cancel: 'Cancel',
} as const;

// ── types ─────────────────────────────────────────────────────────────────────

type TargetMode = 'search' | 'manual';

// ── public contract ───────────────────────────────────────────────────────────

export function TermMappingDialog({
  open,
  onOpenChange,
  fromTerm,
  systems,
  lockedTargetSystem = null,
  mapping,
  distributions = {},
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fromTerm: { system: string; code: string; display: string | null; systemCode: string };
  systems: CodingSystem[];
  /**
   * When set, the ONLY system this dialog will ever offer as a mapping target — the "System"
   * picker (both search mode's Select, shown only when there are 2+ active systems, and manual
   * mode's, shown unconditionally) is replaced with a static, non-interactive label naming this
   * system, and `systems` above is ignored for target-selection purposes entirely (it is still
   * consulted by the caller for OTHER things, e.g. resolving the FROM term's own system code —
   * that lookup lives in the caller, not here).
   *
   * `ObservedTab.tsx` passes this (fixed to `FACILITY_REGISTRY_SYSTEM`) because a mapping authored
   * from the Observed tab is always meant to resolve a facility — offering the full active
   * coding_systems list only sets the operator up to author a mapping that
   * `resolveObservedFacilities` files under `nonFacilityTarget` (self-mapping, or a mapping to an
   * unrelated system like LOINC). `/terminology`'s own `TermDialog` caller omits this prop and
   * keeps the full multi-system picker unchanged.
   */
  lockedTargetSystem?: CodingSystem | null;
  mapping: TermMapping | null;
  distributions?: Record<string, OntologyDistribution>;
  onSaved: (mapping: TermMapping, draftCreated: boolean) => void;
}): JSX.Element {
  const editing = mapping !== null;
  const locked = lockedTargetSystem !== null;

  // ── mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<TargetMode>('search');

  // ── search mode state ─────────────────────────────────────────────────────
  const [picked, setPicked] = useState<PickedTerm | null>(null);
  const [searchSystemId, setSearchSystemId] = useState<string>('');

  // ── manual mode state ─────────────────────────────────────────────────────
  const [manualSystemId, setManualSystemId] = useState<string>('');
  const [manualCode, setManualCode] = useState('');
  const [manualDisplay, setManualDisplay] = useState('');
  // Fix round 2 (mapping-targets report): set only when `locked` AND editing an existing mapping
  // whose stored `toSystem` does not equal `lockedTargetSystem.url`. Holds the REAL stored target so
  // save() can round-trip it unchanged instead of silently substituting the locked system — see the
  // `targetMismatchHint` comment above. Cleared by the explicit "Point at …" retarget action.
  const [targetMismatch, setTargetMismatch] = useState<{ url: string; label: string } | null>(null);

  // ── general ───────────────────────────────────────────────────────────────
  const [mapType, setMapType] = useState<MapType>('SAME-AS');
  const [relationship, setRelationship] = useState('');
  const [owner, setOwner] = useState('');
  const [isActive, setIsActive] = useState(true);

  // ── ui ────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  // ── derived ───────────────────────────────────────────────────────────────
  // Locked: the ONLY selectable system is the locked one, full stop — `systems` plays no role in
  // target selection at all (see `lockedTargetSystem`'s doc comment above).
  const activeSystems = useMemo(
    () => (locked ? [lockedTargetSystem] : systems.filter((s) => s.active)),
    [systems, locked, lockedTargetSystem],
  );

  const manualTargetSystem = useMemo(
    () => activeSystems.find((s) => s.id === manualSystemId) ?? null,
    [activeSystems, manualSystemId],
  );
  const manualTargetSystemCode = manualTargetSystem?.systemCode ?? '';
  const manualTargetDistribution = manualTargetSystem ? distributions[manualTargetSystem.id] : undefined;
  const manualTargetReady = manualTargetDistribution?.indexStatus === 'ready';
  // Fix 3 (mapping-ux report): whether an ontology distribution has EVER been linked to this system
  // at all — distinct from whether it's `ready`. `ObservedTab.tsx` never passes `distributions`
  // (defaulting to `{}`), so a local/synthetic system like FACILITY-REGISTRY always lands here with
  // no entry; that's a structurally different disabled reason than "still building" (see the two
  // hints on `L` above), and the tooltip must say which one it actually is.
  const manualTargetHasDistribution = manualTargetDistribution !== undefined;

  // For search mode: the system whose terms TermPicker will search
  const searchSystemObj = useMemo(
    () => activeSystems.find((s) => s.id === searchSystemId) ?? null,
    [activeSystems, searchSystemId],
  );

  // ── seed state on open / mapping change ───────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mapping) {
      // Edit mode — always use manual mode since we don't have toTermId in our API
      setMapType(mapping.mapType);
      setRelationship(mapping.relationship ?? '');
      setOwner(mapping.owner ?? '');
      setIsActive(mapping.isActive);
      setMode('manual');
      setPicked(null);
      setSearchSystemId(activeSystems[0]?.id ?? '');
      if (locked && mapping.toSystem !== lockedTargetSystem.url) {
        // Fix round 2 (mapping-targets report): the stored mapping targets a DIFFERENT system than
        // the one this dialog is locked to (e.g. the operator's live `BALAB -> DEFAULT_FAC|BALAB`
        // self-mapping, opened via ObservedTab's registry-locked dialog). Saving must never silently
        // normalise `toSystem` to the locked system — that is exactly how a mapping honestly labelled
        // "not a facility mapping" turns into a DIFFERENT broken mapping ("Target missing") with no
        // visible signal to the operator. Surface what is really stored instead of the locked system,
        // and leave `manualSystemId` unset so nothing here silently claims to be the locked system.
        const label = systems.find((s) => s.url === mapping.toSystem)?.systemCode ?? mapping.toSystem;
        setTargetMismatch({ url: mapping.toSystem, label });
        setManualSystemId('');
      } else {
        // Either unlocked (full selector, pre-fill by matching url as before) or locked AND the
        // stored target already agrees with the lock — no disagreement to surface.
        setTargetMismatch(null);
        const matchedSystem = locked ? lockedTargetSystem : activeSystems.find((s) => s.url === mapping.toSystem);
        setManualSystemId(matchedSystem?.id ?? '');
      }
      setManualCode(mapping.toCode);
      setManualDisplay(mapping.toDisplay ?? '');
    } else {
      // Create mode — default to search mode, empty. A new mapping under lock still targets the
      // locked system outright — there is no stored value to disagree with.
      setMode('search');
      setPicked(null);
      setTargetMismatch(null);
      setSearchSystemId(activeSystems[0]?.id ?? '');
      setManualSystemId(activeSystems[0]?.id ?? '');
      setManualCode('');
      setManualDisplay('');
      setMapType('SAME-AS');
      setRelationship('');
      setOwner('');
      setIsActive(true);
    }
  }, [open, mapping]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── canSave ───────────────────────────────────────────────────────────────
  // Manual mode: normally requires a resolved target system. When `targetMismatch` is set, the
  // stored (mismatched) system stands in for that requirement — round-tripping the mapping
  // unchanged (Owner/Relationship/Status-only edits) must remain possible without forcing the
  // operator to first resolve the disagreement.
  const canSave =
    mode === 'search'
      ? picked !== null
      : (manualSystemId.length > 0 || targetMismatch !== null) && manualCode.trim().length > 0;

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // Build the body — toSystem is the url, not the id
      // Fix round 2 (mapping-targets report): when editing under lock with a `targetMismatch`, the
      // stored `toSystem` wins — never the locked system — unless the operator took the explicit
      // "Point at …" retarget action (which clears `targetMismatch` and resolves `manualTargetSystem`
      // normally, same as any other manual-mode save).
      const toSystemUrl =
        mode === 'search'
          ? (picked!.system)
          : (targetMismatch ? targetMismatch.url : (manualTargetSystem?.url ?? ''));
      const toCode = mode === 'search' ? picked!.code : manualCode.trim();
      const toDisplay = mode === 'search' ? picked!.display : manualDisplay.trim() || null;

      const body: Omit<TermMappingInput, 'fromSystem' | 'fromCode'> = {
        toSystem: toSystemUrl,
        toCode,
        toDisplay,
        mapType,
        relationship: relationship.trim() || null,
        owner: owner.trim() || null,
        isActive,
      };

      if (editing) {
        const updated = await updateTermMapping(mapping.id, {
          fromSystem: fromTerm.system,
          fromCode: fromTerm.code,
          ...body,
        });
        onSaved(updated, false);
      } else {
        const res = await createTermMapping(fromTerm.system, fromTerm.code, body);
        onSaved(res.mapping, res.draftCreated);
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleMode = (): void => {
    setMode((m) => (m === 'search' ? 'manual' : 'search'));
    setPicked(null);
    setManualCode('');
    setManualDisplay('');
    setBrowseOpen(false);
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>
            {editing ? L.editTitle : L.newTitle}
          </SheetTitle>
          <SheetDescription>
            {fromTerm.systemCode} {fromTerm.code}
            {fromTerm.display ? ` — ${fromTerm.display}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6">
          {error && (
            <div className="my-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* General section */}
          <section>
            <div className="flex items-center justify-between py-2">
              <h3 className="text-sm font-medium text-foreground">{L.sectionGeneral}</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!canSave || saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? L.saving : editing ? L.save : L.create}
                  </DropdownMenuItem>
                  {targetMismatch && lockedTargetSystem && (
                    <DropdownMenuItem
                      onClick={() => {
                        // Explicit retarget: the operator has chosen to point this mapping at the
                        // locked system. Clear the mismatch AND the stale code — carrying over a code
                        // that belonged to the old system is exactly the second broken mapping this
                        // fix exists to prevent (see the report).
                        setTargetMismatch(null);
                        setManualSystemId(lockedTargetSystem.id);
                        setManualCode('');
                        setManualDisplay('');
                      }}
                    >
                      {L.retargetAction(lockedTargetSystem.systemCode)}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onOpenChange(false)}>
                    {L.cancel}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="-mx-6 border-b border-border" />
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-4">
              <Label className="whitespace-nowrap">{L.mapType}</Label>
              <Select value={mapType} onValueChange={(v) => setMapType(v as MapType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAP_TYPE_VALUES.map((mt) => (
                    <SelectItem key={mt} value={mt}>
                      {L.mapTypeOptions[mt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label htmlFor="mapping-relationship" className="whitespace-nowrap">
                {L.relationship}
              </Label>
              <Input
                id="mapping-relationship"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder={L.relationshipPlaceholder}
              />

              <Label htmlFor="mapping-owner" className="whitespace-nowrap">
                {L.owner}
              </Label>
              <Input
                id="mapping-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder={L.ownerPlaceholder}
              />
            </div>
            <div className="-mx-6 border-b border-border" />
          </section>

          {/* Target section */}
          <section>
            <div className="flex items-center justify-between py-3">
              <h3 className="text-sm font-medium text-foreground">{L.target}</h3>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={toggleMode}
              >
                {mode === 'search' ? L.switchToManual : L.switchToSearch}
              </button>
            </div>
            <div className="-mx-6 border-b border-border" />

            {mode === 'search' ? (
              <div className="space-y-3 py-4">
                {locked ? (
                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-4">
                    <Label htmlFor="mapping-locked-system-search" className="whitespace-nowrap">{L.manualSystem}</Label>
                    {/* Code-review finding (Fix 1, facility-mapping-targets round 1): this used to be a
                        bare <div> — no role, no tabIndex, no accessible name, no id/label pairing. A
                        sighted user reads "System: FACILITY-REGISTRY" by visual proximity; a
                        screen-reader user tabbing the form got nothing. A real, disabled+readOnly
                        <Input> paired to the Label via htmlFor/id matches this repo's established
                        pattern for a field that can never accept input (see ReferencePicker.tsx's
                        "unavailable" branch) — reachable via an accessible query, its label and value
                        announced together, instead of invisible to assistive tech entirely. */}
                    <Input
                      id="mapping-locked-system-search"
                      readOnly
                      disabled
                      value={lockedTargetSystem.systemCode}
                      className="bg-muted/40 text-muted-foreground"
                    />
                  </div>
                ) : activeSystems.length > 1 && (
                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-4">
                    <Label className="whitespace-nowrap">{L.manualSystem}</Label>
                    <Select value={searchSystemId} onValueChange={(v) => { setSearchSystemId(v); setPicked(null); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSystems.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.systemCode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {searchSystemId && (
                  <TermPicker
                    value={picked}
                    onChange={setPicked}
                    systemId={searchSystemId}
                    statuses={['ACTIVE', 'DRAFT']}
                  />
                )}
                <p className="text-[11px] text-muted-foreground">{L.searchHint}</p>
              </div>
            ) : (
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-4">
                <Label htmlFor={locked ? 'mapping-locked-system-manual' : undefined} className="whitespace-nowrap">{L.manualSystem}</Label>
                {locked ? (
                  // See the search-mode branch above for why this is a real, disabled+readOnly
                  // <Input> paired to the Label rather than a bare <div>. Fix round 2: when the
                  // stored mapping disagrees with the lock, show what is REALLY stored (flagged),
                  // never the locked system standing in for it.
                  <Input
                    id="mapping-locked-system-manual"
                    readOnly
                    disabled
                    value={targetMismatch ? targetMismatch.label : lockedTargetSystem.systemCode}
                    className={
                      targetMismatch
                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        : 'bg-muted/40 text-muted-foreground'
                    }
                  />
                ) : (
                  <Select value={manualSystemId} onValueChange={setManualSystemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeSystems.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.systemCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Label htmlFor="mapping-manual-code" className="whitespace-nowrap">
                  {L.manualCode}
                </Label>
                <Input
                  id="mapping-manual-code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="441407007"
                  className="font-mono"
                />

                <Label htmlFor="mapping-manual-display" className="whitespace-nowrap">
                  {L.manualDisplay}
                </Label>
                <Input
                  id="mapping-manual-display"
                  value={manualDisplay}
                  onChange={(e) => setManualDisplay(e.target.value)}
                  placeholder={L.manualDisplayPlaceholder}
                />

                {targetMismatch && (
                  <p className="col-span-2 text-[11px] text-amber-700 dark:text-amber-400">
                    {L.targetMismatchHint}
                  </p>
                )}

                <div className="col-span-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">{L.manualHint}</p>
                  {manualSystemId && (
                    manualTargetReady ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        aria-label={L.browseSystem(manualTargetSystemCode)}
                        onClick={() => setBrowseOpen(true)}
                      >
                        <Network className="h-3.5 w-3.5" />
                        {L.browseSystem(manualTargetSystemCode)}
                      </Button>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="shrink-0">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled
                                className="pointer-events-none h-8 gap-1.5 text-xs"
                                aria-label={L.browseSystem(manualTargetSystemCode)}
                              >
                                <Network className="h-3.5 w-3.5" />
                                {L.browseSystem(manualTargetSystemCode)}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {manualTargetHasDistribution ? L.browseBuildingHint : L.browseNeverAvailableHint}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )
                  )}
                </div>
              </div>
            )}
            <div className="-mx-6 border-b border-border" />
          </section>

          {/* Status section */}
          <section>
            <h3 className="py-3 text-sm font-medium text-foreground">{L.sectionStatus}</h3>
            <div className="-mx-6 border-b border-border" />
            <div className="py-4">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={isActive}
                  onCheckedChange={(v) => setIsActive(v === true)}
                />
                <span className="text-sm">{L.isActive}</span>
              </label>
            </div>
            <div className="-mx-6 border-b border-border" />
          </section>
        </div>
      </SheetContent>
      </Sheet>
      {manualTargetSystem && (
        <OntologyPickerDialog
          open={browseOpen}
          onOpenChange={setBrowseOpen}
          codingSystemId={manualTargetSystem.id}
          systemName={manualTargetSystem.systemName}
          ontologyType={distributions[manualTargetSystem.id]?.ontologyType}
          mode="picker"
          onPick={(node) => {
            setManualCode(node.code);
            setManualDisplay(node.display);
            setBrowseOpen(false);
          }}
        />
      )}
    </>
  );
}
