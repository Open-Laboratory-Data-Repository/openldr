import { useTranslation } from 'react-i18next';
import { canSubmitForm, type FormSchema } from '@openldr/forms/pure';

/** Capture eligibility does not restrict publishing or embedded editors. */
export function SubmissionReadiness({ schema }: { schema: FormSchema }) {
  const { t } = useTranslation();
  const eligible = canSubmitForm(schema);
  return (
    <p role="status" className="mx-3 my-2 shrink-0 rounded-md border border-border bg-muted px-3 py-2 text-xs break-words">
      {t(eligible ? 'forms.captureEligible' : 'forms.captureUnavailable')}
    </p>
  );
}
