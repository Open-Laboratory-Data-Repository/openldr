import { Check } from 'lucide-react';

/**
 * The marketplace capability table. `note` replaces the tick with a muted label — use it where
 * something is real but partial, rather than pretending it is finished.
 *
 * Every row here is backed by something in the repo; see the comment on each.
 */
const CAPABILITIES: Array<{ label: string; note?: string }> = [
  // packages/marketplace/src/workflow-node.ts — a plugin registers as a node in the builder.
  { label: 'Adds nodes to the workflow builder' },
  // Three shipped reference plugins declare read-input + emit-fhir: tabular (csv/xlsx),
  // hl7v2, and whonet-sqlite. Naming the formats keeps the claim checkable.
  { label: 'Turns CSV, Excel, HL7 v2, or SQLite into FHIR' },
  // capabilities.ts: net-egress and data-scope are declared per artifact.
  { label: 'Declares its own permissions and data scope' },
  // signing.ts + trust-store.ts.
  { label: 'Signed bundles, verified against a trust store' },
  // artifact-manifest.ts carries a 'form-template' type, but the install path is not finished —
  // the manifest supporting a type is not the same as an operator being able to install one.
  { label: 'Ships ready-made forms', note: 'planned' },
  // Same as forms: the 'report-template' type exists in the manifest, the install path does not.
  { label: 'Ships ready-made reports', note: 'planned' },
  // artifact-manifest.ts: ui.entry + ui.sha256 is the "webview tier"; the studio-side host is
  // not merged yet, so this is packaged but not installable end to end.
  { label: 'Extends the studio with its own screens', note: 'packaging only' },
  // registry-source.ts + github-publish.ts — point the studio at your own index.
  { label: 'Installs from a registry you host' },
  // compatibility.ts refuses an artifact built for another version.
  { label: 'Refuses to install against the wrong version' },
];

export function MarketplaceTable() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Extend it without forking it</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Plugins, forms, and reports install from a marketplace you host
        </p>
      </div>

      <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left">
          <caption className="sr-only">What an extension can do</caption>
          <thead>
            <tr className="bg-muted">
              <th scope="col" className="px-6 py-4 font-mono text-xs font-normal uppercase tracking-wider text-muted-foreground">
                Capability
              </th>
              {/* "Marketplace" here read as a claim about the store, so every row looked like a
                  feature of the shop rather than of the thing you install. */}
              <th scope="col" className="w-40 px-6 py-4 text-right font-mono text-xs font-normal uppercase tracking-wider text-muted-foreground">
                Extension
              </th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((capability) => (
              <tr key={capability.label} className="border-t border-border">
                <td className="px-6 py-4 text-sm">{capability.label}</td>
                <td className="px-6 py-4 text-right">
                  {capability.note ? (
                    <span className="font-mono text-xs text-muted-foreground">{capability.note}</span>
                  ) : (
                    <Check aria-label="Supported" className="ml-auto h-4 w-4 text-primary" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
