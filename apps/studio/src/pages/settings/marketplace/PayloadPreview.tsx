import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { getRoleCatalog, type ArtifactPayloadMeta, type PackRole, type PackStep } from '@/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-[12px] text-foreground/90 break-all">{value}</dd>
    </div>
  );
}

export function PayloadPreview({ payload }: { payload: ArtifactPayloadMeta | null }) {
  const { t } = useTranslation();
  if (!payload) {
    return <p className="text-sm text-muted-foreground">{t('settings.marketplace.payloadUnavailable')}</p>;
  }
  if (payload.kind === 'plugin') {
    const sha = payload.wasmSha256 ? `${payload.wasmSha256.slice(0, 16)}…` : '—';
    return (
      <dl className="rounded-md border border-border p-3 text-[13px]">
        <Row label={t('settings.marketplace.entrypoint')} value={payload.entrypoint ?? 'convert'} />
        <Row label={t('settings.marketplace.checksum')} value={sha} />
        <Row label={t('settings.marketplace.sandbox')} value={payload.wasi ? t('settings.marketplace.wasiOn') : t('settings.marketplace.wasiOff')} />
        {payload.limits ? (
          <>
            <Row label={t('settings.marketplace.memoryLimit')} value={`${payload.limits.memoryMb} MB`} />
            <Row label={t('settings.marketplace.timeLimit')} value={`${payload.limits.timeoutMs} ms`} />
          </>
        ) : null}
      </dl>
    );
  }
  if (payload.kind === 'content-pack') {
    return <PackSteps steps={Array.isArray(payload.steps) ? payload.steps : []} roles={payload.roles ?? []} />;
  }
  // Non-plugin kinds (form/report/test-definition) — fleshed out in sub-project C.
  return <p className="text-sm text-muted-foreground">{t('settings.marketplace.payloadUnavailable')}</p>;
}

/** Kinds whose count reads as a phrase ("3 capabilities"). Older kinds keep the bare number. */
const COUNT_PHRASE = new Set(['needs', 'role', 'layout']);

function PackSteps({ steps, roles }: { steps: PackStep[]; roles: PackRole[] }) {
  const { t } = useTranslation();
  const hasRole = steps.some((s) => s.kind === 'role');
  // Capability labels come from the same catalog the Roles page uses. Until it loads, or if it
  // fails, a capability shows as its key: the admin still sees every one before confirming.
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!hasRole) return;
    let live = true;
    void getRoleCatalog().then((c) => {
      if (live) setLabels(new Map(c.groups.flatMap((g) => g.capabilities.map((cap) => [cap.key, cap.label] as const))));
    }, () => { /* keys stay as they are */ });
    return () => { live = false; };
  }, [hasRole]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <section data-testid="pack-steps">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.packSteps')}</p>
      <ol className="m-0 list-none space-y-1 rounded-md border border-border p-3 text-[13px]">
        {steps.map((s, i) => {
          const role = s.kind === 'role' ? roles.find((r) => r.name === s.label) : undefined;
          const count = s.kind === 'form'
            ? null
            : COUNT_PHRASE.has(s.kind) ? t(`settings.marketplace.packStepCount.${s.kind}`, { count: s.count }) : String(s.count);
          const expanded = open.has(i);
          return (
            <li key={`${i}-${s.kind}`} data-testid="pack-step">
              <div className="flex items-start justify-between gap-3">
                {/* `overflow-wrap:anywhere`: a bundle id or a role name has no spaces to break on at
                    375 wide, and must wrap rather than push the count off the edge. */}
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium text-foreground">{t(`settings.marketplace.packStep.${s.kind}`, { defaultValue: s.kind })}</span>
                  <span className="text-muted-foreground" aria-hidden="true"> · </span>
                  <span className="text-muted-foreground">{s.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {count !== null ? <span className="font-mono text-[12px] text-foreground/90">{count}</span> : null}
                  {role ? (
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      data-testid="pack-role-toggle"
                      aria-expanded={expanded}
                      aria-label={t('settings.marketplace.packRoleShow', { name: role.name })}
                      onClick={() => toggle(i)}
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
                    </Button>
                  ) : null}
                </span>
              </div>
              {role && expanded ? (
                <ul data-testid="pack-role-capabilities" className="m-0 mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground [overflow-wrap:anywhere]">
                  {role.capabilities.map((key) => <li key={key}>{labels.get(key) ?? key}</li>)}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
