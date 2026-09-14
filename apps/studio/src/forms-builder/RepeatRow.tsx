import { Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TruncatedText } from '@/components/ui/truncated-text';
import type { RepeatNode } from './fieldTree';

/**
 * The header of a repeating FHIR element. Its slots are drawn beneath it by the list.
 *
 * Derived, not stored: it has no id, it cannot be dragged, it has no ⋯ menu and there is nothing
 * to delete. What it buys is that `Location.identifier` reads as one list with two named slots,
 * not two unrelated fields that happen to share a path.
 */
export function RepeatRow({ node }: { node: RepeatNode }): JSX.Element {
  const count = node.slots.length;
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
      >
        <Repeat className="h-3 w-3" />
      </span>
      <div className="min-w-0">
        <TruncatedText as="span" text={node.label} className="block text-sm font-medium text-foreground" />
        <TruncatedText as="span" text={node.path} className="block font-mono text-[10px] text-muted-foreground" />
      </div>
      <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
        {count === 1 ? '1 slot' : `${count} slots`}
      </Badge>
    </div>
  );
}
