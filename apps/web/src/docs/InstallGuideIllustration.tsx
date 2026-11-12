import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DottedGuideFrame } from './DottedGuideFrame';
import { Button } from '@/components/ui/button';
import { Lightbox } from '@/components/Lightbox';
import { INSTALL_COMMANDS, type InstallPlatform, type InstallScene } from './installGuide';

function wrap(lines: string[]): string[] {
  return lines.flatMap(line => {
    const parts: string[] = [];
    while (line.length > 70) {
      const space = line.lastIndexOf(' ', 70);
      const end = space > 34 ? space : 70;
      parts.push(line.slice(0, end));
      line = line.slice(end).trimStart();
    }
    return [...parts, line];
  });
}

function sceneLines(scene: InstallScene, platform: InstallPlatform): string[] {
  const commands = INSTALL_COMMANDS[platform];
  if (scene === 'runtime') return ["docker info --format '{{.OSType}}/{{.Architecture}}'", '', 'linux/x86_64'];
  if (scene === 'compose') return ['docker compose version', '', 'Docker Compose version v5.4.0'];
  if (scene === 'storage') return ['docker system df'];
  if (scene === 'terminal') return ['│'];
  if (scene === 'check') return ['docker --version', 'Docker version 29.5.2 ...', '', 'docker compose version', 'Docker Compose version v5.4.0', '', 'docker info', 'Client: ...', 'Server: ...'];
  if (scene === 'ready') return [
    `${platform === 'windows' ? 'OK' : '✓'} OpenLDR is ready. Open https://localhost`,
    '', 'Keycloak admin password: <generated password>', '',
    'App sign-in: labadmin / <generated password>', '(change it on first login)',
  ];
  if (scene === 'tls-ready') return ['✓ Trusted cert installed for https://openldr.example.org'];
  if (scene === 'renewal') return ['crontab -e'];
  if (scene === 'folder') return [];
  return wrap(commands[scene].split('\n'));
}

function Scene({ scene, platform, alt, expanded = false }: { scene: InstallScene; platform: InstallPlatform; alt: string; expanded?: boolean }) {
  const files = ['config', 'data', 'docker-compose.yml', platform === 'windows' ? 'openldr.ps1' : 'openldr'];
  const lines = sceneLines(scene, platform);
  return (
    <DottedGuideFrame><svg viewBox="40 40 928 488" role="img" aria-label={alt}
      className={expanded ? 'mx-auto block h-auto max-w-full' : 'block w-full'}
      style={expanded ? { width: 'min(1100px, calc(100vw - 7rem), calc((100dvh - 10rem) * 1.9))' } : undefined}>
      <rect x="40" y="40" width="928" height="488" rx="10" fill="var(--sidebar)" stroke="var(--border-2)" />
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
      </> : <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="20" fill="var(--text)">
        {lines.map((line, index) => <text key={index} x="70" y={127 + index * 30}>{line || '\u00a0'}</text>)}
        {scene === 'ready' ? <g fill="none" stroke="var(--brand)" strokeWidth="2"><rect x="63" y="102" width="665" height="37" rx="4" /><rect x="63" y="222" width="665" height="37" rx="4" /></g> : null}
      </g>}
    </svg></DottedGuideFrame>
  );
}

/** These are illustrations of commands and files, not claims of a completed installation. */
export function InstallGuideIllustration({ scene, platform, alt }: { scene: InstallScene; platform: InstallPlatform; alt: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <span className="my-6 block">
    <Button ref={trigger} variant="ghost" className="block h-auto w-full whitespace-normal p-0 hover:bg-transparent" aria-label={alt} onClick={() => setOpen(true)}>
      <Scene scene={scene} platform={platform} alt={alt} />
    </Button>
    <span className="mt-1 block text-xs text-muted-foreground">{alt}</span>
    {open ? createPortal(<Lightbox label={alt} itemNoun="image" onClose={close}><Scene scene={scene} platform={platform} alt={alt} expanded /></Lightbox>, document.body) : null}
  </span>;
}
