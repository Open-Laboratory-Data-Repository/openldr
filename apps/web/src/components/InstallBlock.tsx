import { Link } from 'react-router-dom';
import { ArrowRight, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type TierId = 'standalone' | 'server' | 'enterprise';
interface Tier {
  id: TierId;
  name: string;
  description: string;
  status: string;
  href: string;
  action: string;
}

const TIERS: Tier[] = [
  {
    id: 'standalone', name: 'Standalone',
    description: 'The full OpenLDR app on one computer, without Docker.',
    status: 'Available', href: '/docs/desktop-app', action: 'Install standalone',
  },
  {
    id: 'server', name: 'Server',
    description: 'A shared installation for your laboratory or network.',
    status: 'Available', href: '/docs/install', action: 'Install server',
  },
  {
    id: 'enterprise', name: 'Enterprise',
    description: 'A server deployment across multiple machines.',
    status: 'In development / testing', href: '/docs/getting-started', action: 'Read development status',
  },
];

type FeatureValue = string | boolean;
const FEATURE_GROUPS: { name: string; features: { name: string; values: Record<TierId, FeatureValue> }[] }[] = [
  {
    name: 'Application features',
    features: ['Custom dashboards', 'Custom workflows', 'Plugins', 'Terminology services', 'Reports'].map(name => ({
      name, values: { standalone: true, server: true, enterprise: true },
    })),
  },
  {
    name: 'Deployment',
    features: [
      { name: 'Runs on', values: { standalone: 'One computer', server: 'A shared server', enterprise: 'Multiple servers, planned' } },
      { name: 'Docker containers', values: { standalone: 'Not required', server: 'Required', enterprise: 'Planned' } },
      { name: 'Database', values: { standalone: 'Bundled PostgreSQL', server: 'PostgreSQL by default', enterprise: 'Shared database, planned' } },
      { name: 'File storage', values: { standalone: 'A local folder', server: 'S3-compatible storage', enterprise: 'Redundant storage, planned' } },
      { name: 'Backups', values: { standalone: 'Folder-based', server: 'Operator-managed backups', enterprise: 'Redundant backups, planned' } },
      { name: 'Load balancing', values: { standalone: false, server: 'Manual setup supported', enterprise: 'Planned' } },
    ],
  },
];

function Feature({ value }: { value: FeatureValue }) {
  if (typeof value === 'string') return <span>{value}</span>;
  const Icon = value ? Check : X;
  return <span className="inline-flex items-center justify-center">
    <Icon aria-hidden="true" className={cn('h-5 w-5', value ? 'text-foreground' : 'text-muted-foreground/60')} />
    <span className="sr-only">{value ? 'Yes' : 'No'}</span>
  </span>;
}

function TierHeading({ tier }: { tier: Tier }) {
  return <>
    <p className="m-0 text-xs font-medium">{tier.status}</p>
    <h3 className="mb-3 mt-4 text-xl font-semibold">{tier.name}</h3>
    <p className="m-0 text-4xl font-semibold tracking-tight">Free</p>
    <p className="mb-0 mt-4 text-sm font-normal leading-6 opacity-80">{tier.description}</p>
  </>;
}

function TierLink({ tier }: { tier: Tier }) {
  return <Button asChild variant="ghost" className="h-auto min-h-11 w-full whitespace-normal rounded-none px-3 py-4 text-inherit hover:bg-foreground/5 hover:text-inherit">
    <Link to={tier.href}>{tier.action}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" /></Link>
  </Button>;
}

export function InstallBlock() {
  return <section id="install" aria-label="OpenLDR installation" className="mx-auto max-w-6xl px-6 py-20">
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <h2 className="text-3xl font-semibold tracking-tight">Choose how you run OpenLDR</h2>
      <p className="mt-3 text-base leading-7 text-muted-foreground">OpenLDR is free. Every tier includes the same application features.</p>
    </div>

    <div className="hidden md:block">
      <table className="w-full table-fixed border-collapse text-center text-sm">
        <caption className="sr-only">Compare OpenLDR installation options</caption>
        <thead><tr>
          <td className="w-[28%] border border-border p-6 text-left align-bottom">
            <p className="m-0 font-semibold">Compare installations</p>
            <p className="mb-0 mt-2 leading-6 text-muted-foreground">The same OpenLDR software, with different ways to run it.</p>
          </td>
          {TIERS.map(tier => <th key={tier.id} scope="col" className={cn('border border-border px-5 py-7 align-top', tier.id === 'server' && 'bg-foreground/10 text-foreground')}>
            <TierHeading tier={tier} />
          </th>)}
        </tr></thead>
        {FEATURE_GROUPS.map(group => <tbody key={group.name}>
          <tr><th colSpan={4} scope="rowgroup" className="border border-border bg-muted/40 px-6 py-3 text-left text-xs font-semibold">{group.name}</th></tr>
          {group.features.map(feature => <tr key={feature.name}>
            <th scope="row" className="border border-border px-6 py-5 text-left font-medium">{feature.name}</th>
            {TIERS.map(tier => <td key={tier.id} className="border border-border px-5 py-5 leading-6"><Feature value={feature.values[tier.id]} /></td>)}
          </tr>)}
        </tbody>)}
        <tfoot><tr>
          <th scope="row" className="border border-border px-6 py-5 text-left font-medium">Installation guides</th>
          {TIERS.map(tier => <td key={tier.id} className={cn('border border-border', tier.id === 'server' && 'bg-foreground/10 text-foreground')}><TierLink tier={tier} /></td>)}
        </tr></tfoot>
      </table>
    </div>

    <div className="grid gap-6 md:hidden">
      {TIERS.map(tier => <article key={tier.id} aria-label={`${tier.name} installation`} className="min-w-0 border border-border">
        <div className={cn('border-b border-border p-6 text-center', tier.id === 'server' && 'bg-foreground/10 text-foreground')}><TierHeading tier={tier} /></div>
        {FEATURE_GROUPS.map(group => <div key={group.name}>
          <h4 className="m-0 border-b border-border bg-muted/40 px-5 py-3 text-xs font-semibold">{group.name}</h4>
          <dl className="m-0 divide-y divide-border">
            {group.features.map(feature => <div key={feature.name} className="grid grid-cols-2 items-center gap-4 px-5 py-4 text-sm">
              <dt className="font-medium">{feature.name}</dt>
              <dd className="m-0 text-right leading-6"><Feature value={feature.values[tier.id]} /></dd>
            </div>)}
          </dl>
        </div>)}
        <div className={cn('border-t border-border', tier.id === 'server' && 'bg-foreground/10 text-foreground')}><TierLink tier={tier} /></div>
      </article>)}
    </div>

    <p className="mb-0 mt-6 text-center text-sm leading-6 text-muted-foreground">
      Enterprise is still in development and testing. Its planned deployment includes load balancing and redundant backups.
      There is no Enterprise installer yet.
    </p>
  </section>;
}
