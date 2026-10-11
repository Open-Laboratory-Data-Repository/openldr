import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { catalogResultParams, getForm, submitFormResponse, type CatalogRejectReason, type FormDefinition } from '@/api';
import { canSubmitForm, orderRejectionFieldId, type CodingAnswer } from '@openldr/forms/pure';
import { SubmissionReadiness } from '@/forms-runtime/SubmissionReadiness';
import { useTranslation } from 'react-i18next';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import { RejectSheet } from '@/forms-runtime/RejectSheet';
import type { FormSchema } from '@/forms-runtime/types';

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The order-level rejection (2026-10-11 spec). The page owns it, the runtime only submits it.
  const [orderRejection, setOrderRejection] = useState<CodingAnswer | null>(null);
  const [rejectingOrder, setRejectingOrder] = useState(false);
  const [orderReasons, setOrderReasons] = useState<CatalogRejectReason[] | null>(null);
  const [orderReasonsFailed, setOrderReasonsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getForm(id ?? '').then((loaded) => {
      if (cancelled) return;
      const parsed = asFormSchema(loaded.schema);
      setForm(loaded);
      setSchema(parsed);
      if (!parsed) setError('Form schema is invalid.');
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const isPublished = form?.status === 'published';
  const captureEligible = schema ? canSubmitForm(schema) : false;
  const rejectionField = schema ? orderRejectionFieldId(schema) : null;

  const handleSubmit = async (cleaned: Record<string, unknown>) => {
    if (!id || !isPublished || !captureEligible) return;
    setSubmitting(true);
    setSuccess(false);
    try {
      await submitFormResponse(id, cleaned);
      setSuccess(true);
      setOrderRejection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

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

        {/* Edge-to-edge body — scrollbar at pane edge; FormRuntime owns horizontal padding */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? <div className="px-6 py-8 text-center text-muted-foreground">Loading...</div> : null}
          {error ? <div className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
          {success ? <div className="mx-6 mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">Response captured.</div> : null}
          {form && !isPublished ? <div className="mx-6 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">This form is not published. Submission is disabled until it is published.</div> : null}

          {orderRejection ? (
            <div className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {t('forms.orderRejectedBanner', { reason: orderRejection.display ?? orderRejection.code })}
            </div>
          ) : null}

          {!loading && schema ? <SubmissionReadiness schema={schema} /> : null}

          {!loading && schema && captureEligible ? (
            <FormRuntime
              schema={schema}
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
        </div>
      </div>
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
