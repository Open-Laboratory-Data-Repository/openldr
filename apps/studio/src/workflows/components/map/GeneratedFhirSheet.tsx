import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/** A test's records stay in memory. Copy follows AccessKeysSheet's HTTP/Tailscale fallback. */
export function GeneratedFhirSheet({ preview, onClose }: {
  preview: { row: number; resources: unknown[] } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const P = 'workflows.mapToFhir.sheet';
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const copyRequested = useRef(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const text = preview ? JSON.stringify(preview.resources, null, 2) : '';
  useEffect(() => { setCopyState('idle'); }, [preview]);

  const copy = async () => {
    if (!text) return;
    if (typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        if (field.current?.value === text) setCopyState('copied');
        return;
      } catch { /* HTTP or a refused write uses the selected field below. */ }
    }
    const element = field.current;
    if (!element || element.value !== text) return;
    element.focus();
    element.select();
    const selected = element.selectionStart === 0 && element.selectionEnd === text.length;
    let copied = false;
    try {
      copied = selected && typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch { /* The JSON stays visible for manual copy. */ }
    setCopyState(copied ? 'copied' : 'failed');
  };

  return (
    <Sheet open={preview !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="h-dvh w-full max-w-full gap-0 overflow-hidden p-0 sm:w-[46rem] sm:max-w-[92vw] [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center">
        <SheetHeader className="shrink-0 border-b border-border px-6 py-4 pr-16">
          <SheetTitle>{t(`${P}.generatedTitle`)}</SheetTitle>
          <SheetDescription>{t(`${P}.generatedDescription`, { n: preview?.row ?? 1 })}</SheetDescription>
        </SheetHeader>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-6 py-2">
          <Label htmlFor={id} className="text-xs text-muted-foreground">{t(`${P}.generatedJSON`)}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t(`${P}.generatedActions`)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
              if (copyRequested.current) {
                event.preventDefault();
                copyRequested.current = false;
                field.current?.focus();
                // Wait for the menu's focus trap to close before selecting the JSON.
                void copy();
              }
            }}>
              <DropdownMenuItem onSelect={() => { copyRequested.current = true; }}>
                {t(`${P}.copyJSON`)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
          <Textarea id={id} ref={field} readOnly value={text} className="min-h-0 flex-1 overflow-auto font-mono text-xs" spellCheck={false} />
          {copyState !== 'idle' && (
            <p role="status" className={`shrink-0 text-xs ${copyState === 'copied' ? 'text-muted-foreground' : 'text-amber-500'}`}>
              {t(`${P}.${copyState === 'copied' ? 'jsonCopied' : 'copyUnavailable'}`)}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
