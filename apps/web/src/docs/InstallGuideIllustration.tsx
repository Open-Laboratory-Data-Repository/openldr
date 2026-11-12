import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DottedGuideFrame } from './DottedGuideFrame';
import { Button } from '@/components/ui/button';
import { Lightbox } from '@/components/Lightbox';
import type { InstallPlatform, InstallScene } from './installGuide';
import type { DocLocale } from './content';
import { terminalTranscript } from './terminalTranscript';

function Scene({ scene, platform, alt, expanded = false, command }: { scene: InstallScene; platform: InstallPlatform; alt: string; expanded?: boolean; command?: string }) {
  const files = ['config', 'data', 'docker-compose.yml', platform === 'windows' ? 'openldr.ps1' : 'openldr'];
  const lines = terminalTranscript(scene, platform, command);
  const height = Math.max(488, 108 + lines.length * 30);
  const ratio = 928 / height;
  return (
    <DottedGuideFrame><svg viewBox={`40 40 928 ${height}`} role="img" aria-label={alt}
      className={expanded ? 'mx-auto block h-auto max-w-full' : 'block w-full'}
      style={expanded ? { width: `min(1100px, calc(100vw - 7rem), calc((100dvh - 12rem) * ${ratio}))` } : undefined}>
      <rect x="40" y="40" width="928" height={height} rx="10" fill="var(--sidebar)" stroke="var(--border-2)" />
      <path d="M50 40H958Q968 40 968 50V82H40V50Q40 40 50 40" fill="var(--table-head)" />
      <path d="M40 82H968" stroke="var(--border)" />
      <g fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><path d="M846 61h12" /><rect x="890" y="55" width="11" height="11" rx="1" /><path d="m934 55 11 11m0-11-11 11" /></g>
      {scene === 'folder' ? <>
        <rect x="67" y="102" width="871" height="40" rx="5" fill="var(--bg)" stroke="var(--border)" />
        <text x="86" y="129" fill="var(--text)" fontSize="21" fontFamily="ui-monospace, monospace">{platform === 'windows' ? 'C:\\openldr_ce' : '~/Downloads/openldr_ce'}</text>
        <path d="M40 158H968M215 158V528" stroke="var(--border)" />
        <g fontFamily="Inter, sans-serif" fontSize="22" fill="var(--text-muted)"><text x="72" y="200">Home</text><text x="72" y="247">Downloads</text><text x="72" y="294">Documents</text></g>
        {files.map((file, index) => <g key={file}>
          <rect x="245" y={180 + index * 65} width="20" height="19" rx="3" fill={index < 2 ? 'var(--brand-wash)' : 'none'} stroke="var(--brand)" />
          <text x="284" y={198 + index * 65} fontSize="23" fontFamily="Inter, sans-serif" fill="var(--text)">{file}</text>
          <text x="786" y={198 + index * 65} fontSize="18" fontFamily="Inter, sans-serif" fill="var(--text-muted)">{index < 2 ? 'Folder' : 'File'}</text>
        </g>)}
      </> : <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="20" fill="var(--text)" xmlSpace="preserve" style={{ whiteSpace: 'pre' }}>
        {lines.map((line, index) => <text key={index} data-terminal-kind={line.kind} x="70" y={127 + index * 30} fill={line.kind === 'output' ? 'var(--text-muted)' : 'var(--text)'}>
          {line.prompt ? <tspan fill="var(--brand)">{line.prompt}</tspan> : null}<tspan fontWeight={line.kind === 'input' ? 600 : 400}>{line.text || (line.prompt ? '' : '\u00a0')}</tspan>{line.cursor ? <tspan fill="var(--text)">│</tspan> : null}
        </text>)}
        {scene === 'ready' ? <g fill="none" stroke="var(--brand)" strokeWidth="2"><rect x="63" y="102" width="665" height="37" rx="4" /><rect x="63" y="222" width="665" height="37" rx="4" /></g> : null}
      </g>}
    </svg></DottedGuideFrame>
  );
}

/** These are illustrations of commands and files, not claims of a completed installation. */
export function InstallGuideIllustration({ scene, platform, alt, command, locale = 'en' }: { scene: InstallScene; platform: InstallPlatform; alt: string; command?: string; locale?: DocLocale }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const labels = {
    en: ['Prompt: do not type', 'Command: type, then press Enter', 'Output: read, do not type'],
    fr: ['Invite : ne pas saisir', 'Commande : saisir puis appuyer sur Entrée', 'Sortie : lire sans saisir'],
    pt: ['Prompt: não escrever', 'Comando: escrever e premir Enter', 'Resultado: ler, não escrever'],
  }[locale];
  const legend = scene !== 'folder' ? <span className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={locale === 'fr' ? 'Lire le terminal' : locale === 'pt' ? 'Ler o terminal' : 'Reading the terminal'}>
      <span className="text-primary">{labels[0]}</span><span className="font-medium text-foreground">{labels[1]}</span><span className="text-muted-foreground">{labels[2]}</span>
    </span> : null;
  return <span className="my-6 block">
    {legend}
    <Button ref={trigger} variant="ghost" className="block h-auto w-full whitespace-normal p-0 hover:bg-transparent" aria-label={alt} onClick={() => setOpen(true)}>
      <Scene scene={scene} platform={platform} alt={alt} command={command} />
    </Button>
    <span className="mt-1 block text-xs text-muted-foreground">{alt}</span>
    {open ? createPortal(<Lightbox label={alt} itemNoun="image" onClose={close}><span className="flex min-h-0 flex-1 flex-col items-center justify-center">{legend}<Scene scene={scene} platform={platform} alt={alt} command={command} expanded /></span></Lightbox>, document.body) : null}
  </span>;
}
