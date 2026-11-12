import { useId } from 'react';

/** Installer output with placeholders, drawn as SVG so it stays sharp when enlarged. */
export function InstallResultIllustration({ alt }: { alt: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <span className="my-6 block">
      <svg viewBox="0 0 1008 440" role="img" aria-label={alt} className="block w-full">
        <defs>
          <pattern id={`${id}-dots`} x="12" y="12" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="1.5" fill="var(--text-muted)" />
          </pattern>
          <linearGradient id={`${id}-fade-x`}>
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset=".04" stopColor="white" />
            <stop offset=".96" stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-fade-y`} x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset=".09" stopColor="white" />
            <stop offset=".91" stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}-x`}><rect width="1008" height="440" fill={`url(#${id}-fade-x)`} /></mask>
          <mask id={`${id}-y`}><rect width="1008" height="440" fill={`url(#${id}-fade-y)`} /></mask>
        </defs>
        <g mask={`url(#${id}-x)`} opacity=".45" className="dark:opacity-25">
          <rect width="1008" height="440" fill={`url(#${id}-dots)`} mask={`url(#${id}-y)`} />
        </g>
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
      </svg>
      <span className="mt-1 block text-xs text-muted-foreground">{alt}</span>
    </span>
  );
}
