import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface CellEditChoiceDialogProps {
  open: boolean;
  header: string;
  /** What the cell reads in the file, before this change. The value a sweep would match on. */
  fromValue: string;
  /** What the operator typed. */
  toValue: string;
  onOpenChange: (open: boolean) => void;
  /** `'row'` writes a line-scoped edit; `'everywhere'` writes a value-scoped one. */
  onChoose: (scope: 'row' | 'everywhere') => void;
}

/** The choice decision 2 of the design calls for: change this one row, or change every row in this
 *  column that reads the same thing.
 *
 *  ASKED ONLY ON A CONTROLLED-FIELD COLUMN, and the caller decides that, not this dialog. On an
 *  ordinary column a value repeats by coincidence: two facilities named the same thing are two
 *  facilities, and asking there would put a dialog between the operator and 3 788 typos. On a
 *  controlled-field column a value repeats because it is a category, so one repair almost always
 *  means all of them.
 *
 *  TWO BUTTONS, NOT A dots MENU. AGENTS.md section 5 sends actions to a dots menu. This is not a
 *  set of actions on an object. It is one question with two answers, and a menu would hide half
 *  the question behind a click. Same shape as any confirm dialog in this app. */
export function CellEditChoiceDialog({
  open, header, fromValue, toValue, onOpenChange, onChoose,
}: CellEditChoiceDialogProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // This dialog opens mid-keystroke: the operator is still holding Enter down on the cell
        // when the controlled-field check fires. Radix's own default here focuses the FIRST
        // BUTTON, and that Enter has not finished yet, so its release lands as a click on
        // whichever choice sits first, before the operator ever reads the question. Default
        // autofocus is skipped and the dialog's own container takes focus instead, which is not
        // a button and cannot be clicked by the key still being released.
        // `tabIndex={-1}` makes the container's focusability an explicit, tested fact of this
        // component instead of an implicit side effect of how Radix's FocusScope happens to
        // render today. (Traced: FocusScope also applies its own default `tabIndex={-1}` to this
        // same element via `asChild`, so `.focus()` below already worked before this line. This
        // line does not change behaviour; it stops that behaviour from depending on an internal
        // Radix default this file never asked for.)
        tabIndex={-1}
        onOpenAutoFocus={(e) => { e.preventDefault(); (e.target as HTMLElement).focus(); }}
      >
        <DialogTitle>{t('facilities.import.editScopeTitle')}</DialogTitle>
        <DialogDescription>
          {t('facilities.import.editScopeBody', { header, from: fromValue, to: toValue })}
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="outline" onClick={() => onChoose('row')}>
            {t('facilities.import.editScopeRow')}
          </Button>
          <Button onClick={() => onChoose('everywhere')}>
            {t('facilities.import.editScopeEverywhere')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CellEditChoiceDialog;
