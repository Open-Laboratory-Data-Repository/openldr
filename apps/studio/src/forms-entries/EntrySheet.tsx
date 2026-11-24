import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getFormEntry, type FormEntryDetail } from '@/api';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingState } from '@/components/ui/spinner';
import { TruncatedText } from '@/components/ui/truncated-text';
import { formatEnteredAt } from './format';

// One entry, read only (design 2026-11-22-form-entries, 5.3). Every answer as the saved form copy
// holds it, label left and value right, as TestDetailSheet lays out its fields.

const P = 'forms.entries';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="self-start text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{children}</span>
    </>
  );
}

export function EntrySheet({ entryId, onClose }: { entryId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [entry, setEntry] = useState<FormEntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntry(null);
    setError(null);
    if (!entryId) return;
    let live = true;
    getFormEntry(entryId).then(
      (e) => { if (live) setEntry(e); },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [entryId]);

  const voided = entry?.status === 'entered-in-error';
  // Never a raw user id: a marker the server cannot name any more is a removed user.
  const voidedBy = entry?.statusBy ? (entry.statusByName ?? t(`${P}.removedUser`)) : null;

  return (
    <Sheet open={entryId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4 pr-10">
          <SheetTitle className="min-w-0">
            <TruncatedText text={entry?.entryKey ?? t(`${P}.sheetTitle`)} className="min-w-0" />
          </SheetTitle>
          <SheetDescription>{t(`${P}.sheetHint`)}</SheetDescription>
        </SheetHeader>

        {error ? <p role="alert" className="m-0 px-6 py-4 text-sm text-destructive">{error}</p> : null}
        {!entry && !error ? <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} /> : null}

        {entry ? (
          <>
            <div className="border-b border-border px-6 py-4">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
                <Row label={t(`${P}.person`)}>{entry.enteredByName}</Row>
                <Row label={t(`${P}.colEntered`)}>{formatEnteredAt(entry.enteredAt, i18n.language)}</Row>
                {voided || entry.status === 'incomplete' ? (
                  <Row label={t(`${P}.status`)}>
                    <span className="font-medium text-destructive">
                      {voided ? t(`${P}.statusVoided`) : t(`${P}.statusIncomplete`)}
                    </span>
                  </Row>
                ) : null}
                {voided ? (
                  <>
                    {voidedBy ? <Row label={t(`${P}.voidedBy`)}>{voidedBy}</Row> : null}
                    {entry.statusAt ? <Row label={t(`${P}.voidedAt`)}>{formatEnteredAt(entry.statusAt, i18n.language)}</Row> : null}
                    {entry.statusReason ? <Row label={t(`${P}.reason`)}>{entry.statusReason}</Row> : null}
                  </>
                ) : null}
              </div>
            </div>
            <div className="px-6 py-4">
              {entry.answers === null ? (
                <p className="m-0 text-sm text-muted-foreground">{t(`${P}.answersUnreadable`)}</p>
              ) : entry.answers.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">{t(`${P}.noAnswers`)}</p>
              ) : (
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
                  {entry.answers.map((a, i) => (
                    <Fragment key={`${a.fieldId}-${i}`}>
                      <Row label={a.label}>
                        {/* A yes/no is stored as true or false and shown in the reader's language. */}
                        {a.parts
                          ? a.parts.map((p) => (typeof p === 'boolean' ? t(p ? 'forms.entryYes' : 'forms.entryNo') : p)).join(', ')
                          : a.value}
                      </Row>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
