import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PAGE_TARGETS, AVAILABLE_PAGE_TARGETS } from '@openldr/forms/pure';
import type { FormLintIssue, FormSchema } from '@openldr/forms/pure';
import { LintSummary } from './LintSummary';

// ─── FHIR Version options — copied from Corlix data/fhir-versions.json ───────

export const FHIR_VERSIONS: readonly { value: string; label: string }[] = [
  { value: 'R4',  label: 'R4 (most common)' },
  { value: 'R4B', label: 'R4B' },
  { value: 'R5',  label: 'R5' },
  { value: 'R6',  label: 'R6 (CI build)' },
];

// ─── Resource Type options — common FHIR R4 resource types ───────────────────
// Sourced from the Corlix schemaInfo.resourceTypes list that ships with R4.
// Listed in the same alphabetical order Corlix presents them.

export const FHIR_RESOURCE_TYPES: readonly string[] = [
  'Account', 'ActivityDefinition', 'AdverseEvent', 'AllergyIntolerance',
  'Appointment', 'AppointmentResponse', 'AuditEvent', 'Basic', 'Binary',
  'BiologicallyDerivedProduct', 'BodyStructure', 'Bundle', 'CapabilityStatement',
  'CarePlan', 'CareTeam', 'CatalogEntry', 'ChargeItem', 'ChargeItemDefinition',
  'Claim', 'ClaimResponse', 'ClinicalImpression', 'CodeSystem', 'Communication',
  'CommunicationRequest', 'CompartmentDefinition', 'Composition', 'ConceptMap',
  'Condition', 'Consent', 'Contract', 'Coverage', 'CoverageEligibilityRequest',
  'CoverageEligibilityResponse', 'DetectedIssue', 'Device', 'DeviceDefinition',
  'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement', 'DiagnosticReport',
  'DocumentManifest', 'DocumentReference', 'EffectEvidenceSynthesis', 'Encounter',
  'Endpoint', 'EnrollmentRequest', 'EnrollmentResponse', 'EpisodeOfCare',
  'EventDefinition', 'Evidence', 'EvidenceVariable', 'ExampleScenario',
  'ExplanationOfBenefit', 'FamilyMemberHistory', 'Flag', 'Goal',
  'GraphDefinition', 'Group', 'GuidanceResponse', 'HealthcareService',
  'ImagingStudy', 'Immunization', 'ImmunizationEvaluation',
  'ImmunizationRecommendation', 'ImplementationGuide', 'InsurancePlan', 'Invoice',
  'Library', 'Linkage', 'List', 'Location', 'Measure', 'MeasureReport', 'Media',
  'Medication', 'MedicationAdministration', 'MedicationDispense',
  'MedicationKnowledge', 'MedicationRequest', 'MedicationStatement',
  'MedicinalProduct', 'MedicinalProductAuthorization', 'MedicinalProductContraindication',
  'MedicinalProductIndication', 'MedicinalProductIngredient',
  'MedicinalProductInteraction', 'MedicinalProductManufactured',
  'MedicinalProductPackaged', 'MedicinalProductPharmaceutical',
  'MedicinalProductUndesirableEffect', 'MessageDefinition', 'MessageHeader',
  'MolecularSequence', 'NamingSystem', 'NutritionOrder', 'Observation',
  'ObservationDefinition', 'OperationDefinition', 'OperationOutcome',
  'Organization', 'OrganizationAffiliation', 'Patient', 'PaymentNotice',
  'PaymentReconciliation', 'Person', 'PlanDefinition', 'Practitioner',
  'PractitionerRole', 'Procedure', 'Provenance', 'Questionnaire',
  'QuestionnaireResponse', 'RelatedPerson', 'RequestGroup', 'ResearchDefinition',
  'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject', 'RiskAssessment',
  'RiskEvidenceSynthesis', 'Schedule', 'SearchParameter', 'ServiceRequest', 'Slot',
  'Specimen', 'SpecimenDefinition', 'StructureDefinition', 'StructureMap',
  'Subscription', 'Substance', 'SubstanceNucleicAcid', 'SubstancePolymer',
  'SubstanceProtein', 'SubstanceReferenceInformation', 'SubstanceSourceMaterial',
  'SubstanceSpecification', 'SupplyDelivery', 'SupplyRequest', 'Task',
  'TerminologyCapabilities', 'TestReport', 'TestScript', 'ValueSet',
  'VerificationResult', 'VisionPrescription',
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BuilderHeaderProps {
  schema: FormSchema;
  issues: FormLintIssue[];
  canPublish: boolean;
  /** The persisted form id. When null/undefined, lifecycle actions (Archive, Export, Disable, Delete) are disabled. */
  formId: string | null | undefined;
  /** Current form status (draft/published/archived). Shown as a colored dot to the left of the form name. */
  status?: string | null;
  /** Newest published version number, or null when the form has never been published.
   *  The box beside it is a free-text LABEL; this is the number the snapshot actually has. */
  publishedVersion?: number | null;
  onChange: (patch: Partial<FormSchema>) => void;
  onSave: () => void;
  onPublish: () => void;
  onCompare: () => void;
  onVersions: () => void;
  onAddField: () => void;
  /** Open the form preview sheet. */
  onPreview: () => void;
  /** Open the starter pack chooser. Absent when the form's resource type has no pack. */
  onStartFromPack?: () => void;
  onArchive: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onExport: () => void;
  /** Leave the builder without saving (returns to the Forms list). When omitted, the Cancel item is hidden. */
  onCancel?: () => void;
  /** Globe / language selector mounted by the parent page. */
  languageSlot?: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Status dot helpers ───────────────────────────────────────────────────────

function statusDotClass(status: string | null | undefined): string {
  if (status === 'published') return 'bg-emerald-500';
  if (status === 'archived') return 'bg-amber-500';
  return 'bg-muted-foreground/50';
}

function statusLabel(t: TFunction, status: string | null | undefined): string {
  const s = status ?? 'draft';
  return t(`formBuilder.header.status.${s}`, { defaultValue: s.charAt(0).toUpperCase() + s.slice(1) });
}

export function BuilderHeader({
  schema,
  issues,
  canPublish,
  formId,
  status,
  publishedVersion,
  onChange,
  onSave,
  onPublish,
  onCompare,
  onVersions,
  onAddField,
  onPreview,
  onStartFromPack,
  onArchive,
  onDisable,
  onDelete,
  onExport,
  onCancel,
  languageSlot,
}: BuilderHeaderProps): JSX.Element {
  const { t } = useTranslation();
  const fhirVersionName = (v: { value: string; label: string }) => t(`formBuilder.header.fhirVersions.${v.value}`, { defaultValue: v.label });
  const pageLabel = (p: { id: string; label: string }) => t(`formBuilder.pages.${p.id}`, { defaultValue: p.label });
  const targetPages = schema.targetPages ?? [];

  // Offer only pages that exist today, plus any already-selected page (e.g. a legacy
  // allocation to a not-yet-built page) so it stays visible and removable.
  const pickerTargets = [
    ...AVAILABLE_PAGE_TARGETS,
    ...PAGE_TARGETS.filter((p) => !p.available && targetPages.includes(p.id)),
  ];

  const toggleTargetPage = (pageId: string, checked: boolean) => {
    if (checked) {
      onChange({ targetPages: [...targetPages, pageId] });
    } else {
      onChange({ targetPages: targetPages.filter((p) => p !== pageId) });
    }
  };

  const targetLabel =
    targetPages.length === 0
      ? t('formBuilder.header.targetPagesEmpty')
      : targetPages.length === 1
        ? (() => { const p = PAGE_TARGETS.find((x) => x.id === targetPages[0]); return p ? pageLabel(p) : targetPages[0]; })()
        : t('formBuilder.header.pagesSelected', { count: targetPages.length });

  // The Select value is always set (falls back to the '__none' item), so we can
  // render a computed label as SelectValue's child wrapped in TruncatedText —
  // giving these clip-prone labels (e.g. "R4 (most common)",
  // "CoverageEligibilityResponse") a tooltip-when-clipped instead of a bare cut-off.
  const fhirVersionLabel =
    schema.fhirVersion == null
      ? t('formBuilder.header.none')
      : (() => { const v = FHIR_VERSIONS.find((x) => x.value === schema.fhirVersion); return v ? fhirVersionName(v) : schema.fhirVersion; })();
  const resourceTypeLabel = schema.fhirResourceType ?? t('formBuilder.header.none');

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-end gap-3 flex-wrap rounded-md border border-border bg-card p-3">
        {/* Form name (status dot sits to the left of the label+input column) */}
        <div className="flex-1 min-w-40 flex items-end gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={`h-2.5 w-2.5 rounded-full shrink-0 mb-3 ${statusDotClass(status)}`}
                  aria-label={t('formBuilder.header.statusAria', { status: statusLabel(t, status) })}
                />
              </TooltipTrigger>
              <TooltipContent>{statusLabel(t, status)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {publishedVersion != null ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="mb-3 shrink-0 cursor-help text-xs font-medium text-muted-foreground"
                    aria-label={t('formBuilder.header.versionMeans', { n: publishedVersion })}
                  >
                    v{publishedVersion}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {t('formBuilder.header.versionTip', { n: publishedVersion })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          <div className="flex-1 min-w-0 space-y-1">
            <Label className="text-xs" htmlFor="builder-name">{t('formBuilder.header.formName')}</Label>
            <Input
              id="builder-name"
              aria-label={t('formBuilder.header.formName')}
              value={schema.name}
              placeholder={t('formBuilder.header.formNamePlaceholder')}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
        </div>

        {/* Version label. Free text, and deliberately not the version number: the number is
            assigned by publish and shown next to the status dot. */}
        <div className="w-32 space-y-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Label
                  className="w-fit cursor-help text-xs"
                  htmlFor="builder-version"
                  aria-label={t('formBuilder.header.versionLabelWhat')}
                >
                  {t('formBuilder.header.versionLabel')}
                </Label>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {t('formBuilder.header.versionLabelTip')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Input
            id="builder-version"
            aria-label={t('formBuilder.header.versionLabel')}
            value={schema.versionLabel ?? ''}
            placeholder={t('formBuilder.header.versionPlaceholder')}
            onChange={(e) => onChange({ versionLabel: e.target.value })}
          />
        </div>

        {/* FHIR Version */}
        <div className="space-y-1">
          <Label className="text-xs">{t('formBuilder.header.fhirVersion')}</Label>
          <Select
            value={schema.fhirVersion ?? '__none'}
            onValueChange={(v) => onChange({ fhirVersion: v === '__none' ? null : v })}
          >
            <SelectTrigger className="w-44 text-xs whitespace-nowrap [&>span]:min-w-0 [&>span]:flex-1" aria-label={t('formBuilder.header.fhirVersion')}>
              <SelectValue placeholder={t('formBuilder.header.none')}>
                <TruncatedText text={fhirVersionLabel} className="min-w-0" />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t('formBuilder.header.none')}</SelectItem>
              {FHIR_VERSIONS.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {fhirVersionName(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Target pages */}
        <div className="space-y-1">
          <Label className="text-xs">{t('formBuilder.header.targetPages')}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('formBuilder.header.targetPages')}
                className="flex h-9 w-44 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <TruncatedText
                  text={targetLabel}
                  className={targetPages.length === 0 ? 'min-w-0 text-muted-foreground' : 'min-w-0'}
                />
                <ChevronDown className="h-4 w-4 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {pickerTargets.map((p) => {
                const checked = targetPages.includes(p.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={p.id}
                    checked={checked}
                    onCheckedChange={(v) => toggleTargetPage(p.id, v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {pageLabel(p)}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Resource Type */}
        <div className="space-y-1">
          <Label className="text-xs">{t('formBuilder.header.resourceType')}</Label>
          <Select
            value={schema.fhirResourceType ?? '__none'}
            onValueChange={(v) => onChange({ fhirResourceType: v === '__none' ? null : v })}
          >
            <SelectTrigger className="w-44 text-xs whitespace-nowrap [&>span]:min-w-0 [&>span]:flex-1" aria-label={t('formBuilder.header.resourceType')}>
              <SelectValue placeholder={t('formBuilder.header.none')}>
                <TruncatedText text={resourceTypeLabel} className="min-w-0" />
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__none">{t('formBuilder.header.none')}</SelectItem>
              {FHIR_RESOURCE_TYPES.map((rt) => (
                <SelectItem key={rt} value={rt}>
                  {rt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Language slot (globe control — mounted by parent) */}
        {languageSlot}

        {/* ⋯ actions menu */}
        <div className="flex items-end shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('formBuilder.header.actions')}
                className="h-9 w-9"
              >
                <span aria-hidden className="flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                  </svg>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onAddField()}>
                {t('formBuilder.header.addField')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onPreview()}>
                {t('formBuilder.header.preview')}
              </DropdownMenuItem>
              {onStartFromPack ? (
                <DropdownMenuItem onSelect={() => onStartFromPack()}>
                  {t('formBuilder.header.startFromPack')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSave()}>
                {t('formBuilder.header.saveDraft')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canPublish}
                onSelect={() => onPublish()}
              >
                {t('formBuilder.header.publish')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCompare()}>
                {t('formBuilder.header.compare')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!formId} onSelect={() => onVersions()}>
                {t('formBuilder.header.versions')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!formId} onSelect={() => onArchive()}>
                {t('formBuilder.header.archive')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!formId} onSelect={() => onExport()}>
                {t('formBuilder.header.export')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!formId} onSelect={() => onDisable()}>
                {t('formBuilder.header.disable')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!formId} onSelect={() => onDelete()}>
                {t('formBuilder.header.delete')}
              </DropdownMenuItem>
              {onCancel ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onCancel()}>
                    {t('formBuilder.header.cancel')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Lint banner */}
      <LintSummary issues={issues} />
    </div>
  );
}
