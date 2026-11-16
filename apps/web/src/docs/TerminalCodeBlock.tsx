import type { ReactNode } from 'react';
import type { DocLocale } from './content';
import { DottedGuideFrame } from './DottedGuideFrame';

const LABELS = {
  en: { command: 'Terminal command', powershell: 'PowerShell command', output: 'Terminal output' },
  fr: { command: 'Commande de terminal', powershell: 'Commande PowerShell', output: 'Sortie du terminal' },
  pt: { command: 'Comando de terminal', powershell: 'Comando PowerShell', output: 'Resultado do terminal' },
};

export function TerminalCodeBlock({ children, language, locale }: { children: ReactNode; language: string; locale: DocLocale }) {
  const kind = language === 'text' ? 'output' : language === 'powershell' ? 'powershell' : 'command';
  return <div className="my-6">
    <DottedGuideFrame>
      <span className="web-doc-terminal" data-terminal-kind={kind === 'output' ? 'output' : 'input'}>
        <span className="web-doc-terminal-bar">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
          </span>
          <span>{LABELS[locale][kind]}</span>
        </span>
        <pre>{children}</pre>
      </span>
    </DottedGuideFrame>
  </div>;
}
