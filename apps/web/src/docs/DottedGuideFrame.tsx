import type { ReactNode } from 'react';

/** Uses the same spacing, opacity and fading as the approved in-app illustrations. */
export function DottedGuideFrame({ children }: { children: ReactNode }) {
  return <span className="web-doc-dotted-frame">
    <span className="web-doc-dotted-dots" aria-hidden="true" />
    <span className="relative block">{children}</span>
  </span>;
}
