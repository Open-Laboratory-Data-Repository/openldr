import { DottedGuideFrame } from './DottedGuideFrame';
import type { DocLocale } from './content';

/** Installer output with placeholders, drawn as SVG so it stays sharp when enlarged. */
export function InstallResultIllustration({ alt, locale = 'en' }: { alt: string; locale?: DocLocale }) {
  return (
    <span className="my-6 block">
      <span className="mb-2 block text-xs text-muted-foreground">{{ en: 'Output from the installer. Read these lines; do not type them.', fr: "Sortie de l'installateur. Lisez ces lignes sans les saisir.", pt: 'Resultado do instalador. Leia estas linhas; não as escreva.' }[locale]}</span>
      <DottedGuideFrame><svg viewBox="40 40 928 360" role="img" aria-label={alt} className="block w-full">
        <rect x="40" y="40" width="928" height="360" rx="10" fill="var(--sidebar)" stroke="var(--border-2)" />
        <path d="M50 40H958Q968 40 968 50V82H40V50Q40 40 50 40" fill="var(--table-head)" />
        <path d="M40 82H968" stroke="var(--border)" />
        <g fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
          <path d="M846 61h12" /><rect x="890" y="55" width="11" height="11" rx="1" /><path d="m934 55 11 11m0-11-11 11" />
        </g>
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="22" fill="var(--text)">
          <text x="70" y="138">✓ OpenLDR is ready. Open https://localhost</text>
          <text x="70" y="185" fill="var(--text-muted)">Keycloak admin password: &lt;generated password&gt;</text>
          <text x="70" y="232">App sign-in: labadmin / &lt;generated password&gt;</text>
          <text x="70" y="267" fill="var(--text-muted)">(change it on first login)</text>
        </g>
        <g fill="none" stroke="var(--brand)" strokeWidth="2">
          <rect x="65" y="111" width="660" height="38" rx="4" />
          <rect x="65" y="207" width="680" height="38" rx="4" />
        </g>
      </svg></DottedGuideFrame>
      <span className="mt-1 block text-xs text-muted-foreground">{alt}</span>
    </span>
  );
}
