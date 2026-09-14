import * as React from 'react';
import { Plus, Undo2 } from 'lucide-react';
import { lookupBinding } from '@openldr/fhir/paths';
import {
  codingKey, isSurveyForm, offerSuggestions, resolveFhirPath,
  type CodeSuggestion, type FormField, type FormFieldCoding,
} from '@openldr/forms/pure';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { codeSuggestions, importSuggestedCode, undoSuggestedCode } from '../../api';

/** Binding codes no form uses are capped here. A bound set can hold 4,000; the search finds the rest. */
const UNCOUNTED_LIMIT = 50;

/**
 * Codes worth putting on this field, each labelled with where it came from (spec S7, row A7).
 * Ported from corlix `components/form-builder/CodeSuggestionPanel.tsx`.
 *
 * Two things it must not do. It must not imply a code does not exist when CE's terminology is only
 * thin, so an empty list says so. And it must not quietly grow the terminology: adding a code CE
 * lacks writes a term, so the panel says it did and offers Undo. Only a user who may manage
 * terminology can do that; anyone else sees such a code greyed (operator ruling, 2026-09-14).
 */
export function CodeSuggestionPanel({ field, fhirResourceType, formId, onAdd }: {
  field: FormField;
  fhirResourceType: string | null;
  formId: string | null;
  onAdd: (coding: FormFieldCoding) => void;
}): JSX.Element | null {
  const { hasCapability } = useAuth();
  const canManage = hasCapability('terminology.manage');
  const path = resolveFhirPath(field.fhirPath, fhirResourceType);
  // The field's own set wins. Otherwise FHIR's standard binding for the element, from S6. A survey
  // maps to no resource, so it has none.
  const valueSetUrl = field.valueSetUrl ?? (isSurveyForm(fhirResourceType) ? null : lookupBinding(path)?.valueSet ?? null);

  const [rows, setRows] = React.useState<CodeSuggestion[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<{ system: string; code: string; label: string } | null>(null);

  React.useEffect(() => {
    if (!path) return;
    let alive = true;
    setRows(null);
    setLoadError(null);
    void (async () => {
      try {
        const found = await codeSuggestions({ fhirPath: path, valueSetUrl, formId });
        if (alive) setRows(found);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [path, valueSetUrl, formId]);

  if (!path) return null;

  const coding = (s: CodeSuggestion): FormFieldCoding => ({ system: s.system, code: s.code, ...(s.display ? { display: s.display } : {}) });
  const markHeld = (target: { system: string; code: string }, inTerminology: boolean) =>
    setRows((prev) => prev?.map((r) => (r.system === target.system && r.code === target.code ? { ...r, inTerminology } : r)) ?? prev);

  async function accept(s: CodeSuggestion): Promise<void> {
    setNotice(null);
    if (s.inTerminology) {
      onAdd(coding(s));
      return;
    }
    try {
      const result = await importSuggestedCode({ system: s.system, code: s.code, display: s.display });
      if (!result.ok && result.reason === 'unknown-system') {
        setNotice('That code belongs to a coding system this installation does not have. Add the system on the Terminology page first.');
        return;
      }
      // 'already-present' means someone added the code since the list loaded. It is real, so it
      // goes on the field, with nothing to undo.
      markHeld(s, true);
      if (result.ok) setAdded({ system: s.system, code: s.code, label: s.display ?? s.code });
      onAdd(coding(s));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function undo(): Promise<void> {
    if (!added) return;
    try {
      await undoSuggestedCode({ system: added.system, code: added.code });
      markHeld(added, false);
      setAdded(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  const { shown, hidden } = offerSuggestions(rows ?? [], field.code ?? [], UNCOUNTED_LIMIT);

  return (
    <div className="space-y-1.5 py-3">
      <div className="text-xs font-medium text-muted-foreground">Suggested codes</div>

      {loadError ? (
        <p className="text-xs text-destructive">{loadError}</p>
      ) : rows === null ? (
        <LoadingState label="Looking for suggestions…" className="min-h-[4rem] rounded-md" />
      ) : rows.length === 0 ? (
        // Nothing found means the terminology is thin, not that no code exists.
        <StripedEmpty className="min-h-[4rem] rounded-md px-3 py-2">
          No suggestions yet. Your terminology may be thin rather than complete. Add codes on the Terminology page, or search below.
        </StripedEmpty>
      ) : shown.length === 0 ? (
        // Everything found is already on the field. That is a success, so no advice about the terminology.
        <p className="text-xs text-muted-foreground">Every suggestion for this field is already on it.</p>
      ) : (
        <div>
          {shown.map((s) => {
            const blocked = !s.inTerminology && !canManage;
            return (
              <Button
                key={codingKey(s.system, s.code)}
                type="button"
                variant="ghost"
                disabled={blocked}
                onClick={() => void accept(s)}
                className="group mb-0.5 h-auto w-full items-start justify-start gap-2 whitespace-normal px-2 py-1.5 text-left font-normal"
              >
                <span className="mt-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground group-hover:border-primary group-hover:text-primary">
                  <Plus className="h-2.5 w-2.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-foreground">{s.display ?? s.code}</span>
                    {s.source === 'binding' && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Binding</Badge>}
                    {s.count !== undefined && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{`Your forms · ${s.count}`}</Badge>}
                    {!s.inTerminology && <span className="text-[10px] text-primary">not in your terminology</span>}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{`${s.code} · ${s.system}`}</span>
                  {blocked && (
                    <span className="block text-[10px] text-muted-foreground">Someone who can manage terminology must add this code first.</span>
                  )}
                </span>
              </Button>
            );
          })}
          {hidden > 0 && (
            <p className="px-2 pt-1 text-[11px] text-muted-foreground">{`${hidden} more codes from the binding. Search below to find one.`}</p>
          )}
        </div>
      )}

      {notice && <p className="text-xs text-destructive">{notice}</p>}

      {added && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{`Added “${added.label}” to your terminology.`}</span>
          <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void undo()}>
            <Undo2 className="mr-1 h-3 w-3" />
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}
