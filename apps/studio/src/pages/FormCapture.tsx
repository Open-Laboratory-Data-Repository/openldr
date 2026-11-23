import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  catalogResultParams, FormEntryRepeatError, getForm, getFormEntryContext, submitFormResponse,
  type CatalogRejectReason, type FormDefinition,
} from '@/api';
import { canSubmitForm, entryFieldsOf, orderRejectionFieldId, type CodingAnswer } from '@openldr/forms/pure';
import { SubmissionReadiness } from '@/forms-runtime/SubmissionReadiness';
import { useTranslation } from 'react-i18next';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import { RejectSheet } from '@/forms-runtime/RejectSheet';
import type { FormSchema } from '@/forms-runtime/types';
import { EntriesTab } from '@/forms-entries/EntriesTab';
import { EntrySheet } from '@/forms-entries/EntrySheet';
import { NO_SITE_CONTROLS, siteControls, type SiteControls } from '@/forms-entries/siteControls';
import { enteredAtParts } from '@/forms-entries/format';

function asFormSchema(value: unknown): FormSchema | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<FormSchema>;
  return typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.fields)
    ? (s as FormSchema)
    : null;
}

export function FormCapture() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // The order-level rejection (2026-10-11 spec). The page owns it, the runtime only submits it.
  const [orderRejection, setOrderRejection] = useState<CodingAnswer | null>(null);
  const [rejectingOrder, setRejectingOrder] = useState(false);
  const [orderReasons, setOrderReasons] = useState<CatalogRejectReason[] | null>(null);
  const [orderReasonsFailed, setOrderReasonsFailed] = useState(false);
  // The tab is in the URL, so a link can open the list (design 2026-11-22-form-entries, 5.3).
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'entries' ? 'entries' : 'new';
  // The list mounts the first time it is opened, then stays, so its filters and page survive a tab switch.
  const [entriesSeen, setEntriesSeen] = useState(tab === 'entries');
  const [entriesVersion, setEntriesVersion] = useState(0);
  // The site rules. Null until read; the form waits, so a clerk's facility is in it from the start.
  const [site, setSite] = useState<SiteControls | null>(null);
  // A refused repeat number: the entry that holds it, and the number refused.
  const [repeat, setRepeat] = useState<{ entry: FormEntryRepeatError['entry']; value: string } | null>(null);
  const [viewingEntry, setViewingEntry] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getForm(id ?? '').then((loaded) => {
      if (cancelled) return;
      const parsed = asFormSchema(loaded.schema);
      setForm(loaded);
      setSchema(parsed);
      if (!parsed) toast.error('Form schema is invalid.');
      setSite(null);
      // A failed read leaves the form open. The server applies the same rules on submit.
      if (parsed) {
        void getFormEntryContext(loaded.id)
          .then((context) => siteControls(parsed, context))
          .catch(() => NO_SITE_CONTROLS)
          .then((controls) => { if (!cancelled) setSite(controls); });
      }
    }).catch((err) => {
      if (!cancelled) toast.error(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const isPublished = form?.status === 'published';
  const captureEligible = schema ? canSubmitForm(schema) : false;
  const rejectionField = schema ? orderRejectionFieldId(schema) : null;
  const keyFieldId = schema ? entryFieldsOf(schema).keyFieldId : null;

  const showTab = (next: string) => {
    if (next === 'entries') setEntriesSeen(true);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'entries') params.set('tab', 'entries');
      else params.delete('tab');
      return params;
    }, { replace: true });
  };

  const handleSubmit = async (cleaned: Record<string, unknown>) => {
    if (!id || !isPublished || !captureEligible) return;
    setSubmitting(true);
    setRepeat(null);
    try {
      await submitFormResponse(id, cleaned);
      toast.success(t('forms.toastCaptured'));
      setEntriesVersion((v) => v + 1);
    } catch (err) {
      // A repeated number goes beside its field. The answers stay, so the clerk can change it.
      if (err instanceof FormEntryRepeatError) {
        const typed = keyFieldId ? cleaned[keyFieldId] : undefined;
        setRepeat({ entry: err.entry, value: typed == null ? '' : String(typed) });
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // The server's sentence is English, for the CLI. The screen builds its own in the user's language.
  // The lab time zone is not known here, so the date and time are the browser's local time.
  const repeatSentence = (entry: FormEntryRepeatError['entry']) => {
    const at = enteredAtParts(entry.enteredAt, i18n.language);
    // The sentence ends on a full stop, so a name that already ends on one, such as "Aisha M.", drops it.
    const name = entry.enteredByName.replace(/\.$/, '');
    return t('forms.entries.repeatMessage', { key: entry.entryKey ?? '', date: at.date, time: at.time, name });
  };

  const repeatNotice = repeat ? (
    <span>
      {repeatSentence(repeat.entry)}{' '}
      <Button
        type="button" variant="ghost" className="h-auto p-0 text-xs font-medium underline underline-offset-2 hover:bg-transparent"
        onClick={() => setViewingEntry(repeat.entry.id)}
      >
        {t('forms.entries.viewRepeat')}
      </Button>
    </span>
  ) : null;

  return (
    <AppShell title="Forms" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Single-line header: status badge + name/meta on left, ⋯ menu on right */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {form ? <Badge variant="outline">{form.status}</Badge> : null}
          <div className="flex min-w-0 flex-1 items-baseline">
            <TruncatedText text={schema?.name ?? form?.name ?? 'Form'} className="min-w-0 shrink text-sm font-semibold" />
            {form ? (
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {form.versionLabel ?? 'No version'} · {form.fhirResourceType ?? 'Custom'}
              </span>
            ) : null}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Form actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {rejectionField ? (
                orderRejection ? (
                  <DropdownMenuItem onSelect={() => setOrderRejection(null)}>{t('forms.orderUndoReject')}</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => {
                      // The sheet shows a spinner until this answers, and an error line if it fails.
                      setOrderReasons(null);
                      setOrderReasonsFailed(false);
                      void catalogResultParams([], null)
                        .then((answer) => setOrderReasons(answer.rejectReasons.order))
                        .catch(() => setOrderReasonsFailed(true));
                      setRejectingOrder(true);
                    }}
                  >
                    {t('forms.orderReject')}
                  </DropdownMenuItem>
                )
              ) : null}
              <DropdownMenuItem
                disabled={loading || submitting || !schema || !isPublished || !captureEligible}
                onSelect={() => {
                  // Field errors show on the form, so the form tab comes forward.
                  showTab('new');
                  (document.getElementById('form-capture') as HTMLFormElement | null)?.requestSubmit();
                }}
              >
                Submit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/forms')}>
                Cancel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Tabs value={tab} onValueChange={showTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="h-9 w-full shrink-0 px-3">
            <TabsTrigger value="new">{t('forms.entries.tabNew')}</TabsTrigger>
            <TabsTrigger value="entries">{t('forms.entries.tabEntries')}</TabsTrigger>
          </TabsList>
        {/* Edge-to-edge body: the scrollbar sits at the pane edge, and FormRuntime owns the side padding.
            forceMount keeps the form, and what the clerk typed, while the list is open; the tab's own
            data-[state=inactive]:hidden hides it (AGENTS.md section 6). */}
        <TabsContent value="new" forceMount className="min-h-0 flex-1 overflow-auto">
          {loading || (schema && !site) ? <div className="px-6 py-8 text-center text-muted-foreground">Loading...</div> : null}
          {/* A form with no requisition field has nowhere beside it to say so. */}
          {repeatNotice && !keyFieldId ? <div className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{repeatNotice}</div> : null}
          {form && !isPublished ? <div className="mx-6 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">This form is not published. Submission is disabled until it is published.</div> : null}

          {orderRejection ? (
            <div className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {t('forms.orderRejectedBanner', { reason: orderRejection.display ?? orderRejection.code })}
            </div>
          ) : null}

          {!loading && schema ? <SubmissionReadiness schema={schema} /> : null}

          {!loading && schema && captureEligible && site ? (
            <FormRuntime
              schema={schema}
              initialAnswers={site.initialAnswers}
              fieldControls={{
                readOnly: site.readOnly,
                offerOnly: site.offerOnly,
                disabled: site.noFacility,
                notices: {
                  ...Object.fromEntries(site.noFacility.map((f) => [f, t('forms.entries.noFacility')])),
                  ...(repeatNotice && keyFieldId ? { [keyFieldId]: repeatNotice } : {}),
                },
              }}
              onAnswersChange={(answers) => {
                // A changed number is a new try, so the refusal of the old one goes.
                if (!repeat || !keyFieldId) return;
                const typed = answers[keyFieldId];
                if ((typed == null ? '' : String(typed)) !== repeat.value) setRepeat(null);
              }}
              // Two distinct ids: `formId` is the DOM id the ⋯ menu's requestSubmit() targets,
              // `formDefinitionId` is the stored form the reference-search route is scoped to.
              formId="form-capture"
              formDefinitionId={id}
              footer={null}
              orderRejection={rejectionField ? orderRejection : undefined}
              onSubmit={handleSubmit}
              // The runtime is schema-driven and has no i18n of its own, so this page, which has one,
              // supplies the row list's chrome (FormRuntime.tsx, suggestCopy has the same reasoning).
              testDetailsCopy={{
                empty: t('forms.testsEmpty'),
                loading: t('forms.testsLoading'),
                open: t('forms.testsOpen'),
                reject: t('forms.testsReject'),
                remove: t('forms.testsRemove'),
                noSpecimen: t('forms.testsNoSpecimen'),
                rejected: t('forms.testsRejected'),
                orderRejected: t('forms.testsOrderRejected'),
                language: i18n.language,
                range: t('forms.range'),
                chooseRange: t('forms.rangeChoose'),
                misfit: t('forms.rangeMisfit'),
                anyone: t('forms.rangeAnyone'),
                ageFrom: t('forms.rangeAgeFrom'),
                ageTo: t('forms.rangeAgeTo'),
                ageBetween: t('forms.rangeAgeBetween'),
              }}
              browseCopy={{
                title: t('forms.browseTitle'),
                actions: t('forms.browseActions'),
                search: t('forms.browseSearch'),
                category: t('forms.browseCategory'),
                anyCategory: t('forms.browseAnyCategory'),
                notOffered: t('forms.browseNotOffered'),
                empty: t('forms.browseEmpty'),
                noMatch: t('forms.browseNoMatch'),
                error: t('forms.browseError'),
                loading: t('forms.browseLoading'),
              }}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="entries" forceMount className="flex min-h-0 flex-1 flex-col">
          {entriesSeen && id ? <EntriesTab formId={id} refreshKey={entriesVersion} /> : null}
        </TabsContent>
        </Tabs>
      </div>
      <EntrySheet entryId={viewingEntry} onClose={() => setViewingEntry(null)} />
      {rejectingOrder ? (
        <RejectSheet
          level="order"
          reasons={orderReasons ?? []}
          loading={orderReasons === null && !orderReasonsFailed}
          error={orderReasonsFailed ? t('forms.orderRejectError') : null}
          copy={{
            title: t('forms.orderRejectTitle'),
            hint: t('forms.orderRejectHint'),
            reject: t('forms.orderRejectAction'),
            none: t('forms.orderRejectNone'),
            choose: t('forms.orderRejectChoose'),
          }}
          onReject={(reason) => {
            setOrderRejection({ system: reason.system, code: reason.code, display: reason.display });
            setRejectingOrder(false);
          }}
          onClose={() => setRejectingOrder(false)}
        />
      ) : null}
    </AppShell>
  );
}
