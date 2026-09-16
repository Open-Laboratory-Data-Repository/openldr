import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { cn } from '@/lib/cn';

export interface RejectReason { system: string; code: string; display: string | null }

export interface RejectCopy {
  title?: string;
  hint?: string;
  reject?: string;
  none?: string;
  choose?: string;
}

/**
 * The reasons arrive as a prop, expanded by the server (apps/server/src/test-catalog-routes.ts). This
 * component names no value set: the studio must never carry clinical vocabulary (AGENTS.md section 8).
 */
export function RejectSheet({ level, reasons, onReject, onClose, copy }: {
  level: 'order' | 'test';
  reasons: RejectReason[];
  onReject: (reason: RejectReason) => void;
  onClose: () => void;
  copy?: RejectCopy;
}): JSX.Element {
  const t = {
    title: level === 'order' ? 'Reject this order' : 'Reject this test',
    hint: 'The reason is stored with the order and reaches the lab record.',
    reject: 'Reject',
    none: 'No reasons are configured.',
    choose: 'Choose a reason first',
    ...(copy ?? {}),
  };
  const [chosen, setChosen] = useState<RejectReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (!chosen) { setError(t.choose); return; }
    onReject(chosen);
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="flex flex-row items-start justify-between gap-3 p-6 pb-4">
          <div>
            <SheetTitle>{t.title}</SheetTitle>
            <SheetDescription>{t.hint}</SheetDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Reject actions"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={submit}>{t.reject}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SheetHeader>

        <div className="px-6 pb-6">
          {reasons.length === 0 ? (
            <StripedEmpty className="min-h-[8rem]"><span className="text-sm text-muted-foreground">{t.none}</span></StripedEmpty>
          ) : (
            <div className="rounded-md border border-border">
              {reasons.map((reason) => (
                <button
                  key={`${reason.system}|${reason.code}`}
                  type="button"
                  className={cn(
                    'block w-full border-b border-border p-3 text-left text-sm last:border-b-0 hover:bg-accent',
                    chosen?.code === reason.code && 'bg-accent',
                  )}
                  onClick={() => { setChosen(reason); setError(null); }}
                >
                  <span>{reason.display ?? reason.code}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{reason.code}</span>
                </button>
              ))}
            </div>
          )}
          {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
          {/* The header menu carries the action per AGENTS.md section 5. This repeats it, because a
              sheet whose only control is inside a menu reads as broken on a phone. */}
          <Button className="mt-4" variant="outline" onClick={submit}>{t.reject}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
