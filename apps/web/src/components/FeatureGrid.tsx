import type { ReactNode } from 'react';
import {
  Archive,
  Braces,
  Check,
  Database,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  FileText,
  Globe2,
  Image as ImageIcon,
  Library,
  Lock,
  Network,
  ScanText,
  Server,
  TestTubes,
  Workflow,
} from 'lucide-react';

// The bento layout: a wide card and two on the first row, four equal on the second.
function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex min-h-[19rem] flex-col overflow-hidden rounded-xl border border-border bg-card p-6">
      <h3 className="mb-3 flex items-center gap-2.5 text-[17px] font-semibold">
        <span className="text-muted-foreground [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Copy({ children, className = 'max-w-[30ch]' }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm leading-6 text-muted-foreground ${className}`}>{children}</p>;
}

function Strong({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-foreground">{children}</b>;
}

/**
 * The illustration sits on its own recessed panel that runs to the card's edges, ruled with a faint
 * grid. It gives the drawing a surface to stand on so the lower half of a card is not empty.
 *
 * The height is fixed rather than driven by the copy above it. Cards in a row are already equal
 * height, so a fixed panel anchored to the bottom puts every separator on the same line — otherwise
 * a card with one more line of copy sits its rule lower than its neighbour's.
 */
function Art({ children }: { children: ReactNode }) {
  return (
    <div
      className="-mx-6 -mb-6 mt-auto flex h-[10rem] items-center border-t border-border bg-muted px-6"
      style={{
        backgroundImage:
          'linear-gradient(var(--rule) 1px, transparent 1px), linear-gradient(90deg, var(--rule) 1px, transparent 1px)',
        backgroundSize: '26px 26px',
      }}
    >
      <div className="w-full">{children}</div>
    </div>
  );
}

function Tile({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs ${
        dim ? 'text-muted-foreground/40' : 'text-muted-foreground'
      }`}
    >
      {children}
    </div>
  );
}

// No vendor logos: the repo ships none, and drawing them from memory gets them wrong. A single
// monochrome glyph per engine keeps the row calm — only the default store is tinted.
function DatabaseTile({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <div className={`w-[5.4rem] text-center text-[11px] ${active ? 'text-primary' : 'text-muted-foreground'}`}>
      <div
        className={`mb-2 grid h-[4.6rem] place-items-center rounded-lg border bg-card ${
          active ? 'border-primary' : 'border-border'
        }`}
      >
        <Database aria-hidden="true" className="h-6 w-6" />
      </div>
      <span className="leading-tight">{name}</span>
    </div>
  );
}

// 3.4rem is the storage tile's cap, so the two illustrations use one box size.
function SyncNode({ icon }: { icon: ReactNode }) {
  return (
    <span className="grid h-[3.4rem] w-[3.4rem] place-items-center rounded-lg border border-border bg-card text-primary [&>svg]:h-[18px] [&>svg]:w-[18px]">
      {icon}
    </span>
  );
}

// Only what OpenLDR actually handles: CSV and Excel in, FHIR JSON on the wire, zipped terminology
// distributions, SQLite imports, scanned request forms, specimen data, PDF out. The HL7 v2 tile
// went because file-code and file-json are both brace glyphs — indistinguishable at 18px.
const STORAGE_ICONS = [
  FileSpreadsheet,
  FileText,
  FileJson,
  FileArchive,
  Database,
  ImageIcon,
  ScanText,
  TestTubes,
];

export function FeatureGrid() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Everything a laboratory network needs</h2>
        {/* The hero already makes the self-hosting point; repeating it here spends the subtitle on
            something the reader has just been told. */}
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Ingest, store, sync, and report laboratory data
        </p>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.6fr_1fr_1fr]">
        <Card icon={<Database />} title="Multi-database support">
          {/* This card is the widest in the row, so its copy and checklist sit side by side rather
              than stacking down the left and leaving the right half empty. */}
          <div className="grid gap-x-10 gap-y-5 sm:grid-cols-[1.15fr_1fr] sm:items-start">
            <Copy className="max-w-[38ch]">
              <Strong>Postgres is the default store.</Strong> The warehouse it publishes to can be SQL
              Server, MySQL, or MariaDB — so reporting runs on the database your organisation already
              knows.
            </Copy>
            {/* list-none pl-0: this list keeps the browser's 40px indent otherwise, which pushes it
                out of line with the copy beside it. */}
            <ul className="list-none space-y-1 pl-0 text-[13.5px]">
              {['Migrations run on boot', 'Publish to your own warehouse', 'No vendor lock-in'].map((item) => (
                <li key={item} className="flex gap-2">
                  <Check aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <Art>
            {/* MariaDB rides the MySQL adapter — the studio's own connector picker lists them as one
                option, so they are one tile here too. */}
            <div className="flex items-start justify-around gap-3.5">
              <DatabaseTile name="Postgres" active />
              <DatabaseTile name="SQL Server" />
              <DatabaseTile name="MySQL / MariaDB" />
            </div>
          </Art>
        </Card>

        <Card icon={<Lock />} title="Authentication">
          <Copy>
            <Strong>Sign-in is standard OIDC.</Strong> Keycloak ships as the default — point it at your own
            provider instead. Roles are built from capabilities you edit.
          </Copy>
          <Art>
            <div className="grid gap-2">
              <Tile>admin</Tile>
              <Tile>technician</Tile>
              <Tile dim>reports.view · forms.submit</Tile>
            </div>
          </Art>
        </Card>

        <Card icon={<Network />} title="Distributed sync">
          <Copy>
            <Strong>One central instance, or one per site.</Strong> Where the network or the data policy
            needs an install on-premise, it mirrors to central when the link allows.
          </Copy>
          <Art>
            {/* The connectors stretch instead of being a fixed 24px, so the three nodes sit at the
                panel's edges and middle rather than huddling in the centre of a wide card. */}
            <div className="flex items-center gap-3">
              <SyncNode icon={<Server />} />
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <SyncNode icon={<Globe2 />} />
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <SyncNode icon={<Server />} />
            </div>
            <p className="mt-4 text-center font-mono text-xs text-muted-foreground">site → central → site</p>
          </Art>
        </Card>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={<Archive />} title="Storage">
          <Copy>
            Keep raw payloads, attachments, and exports in <Strong>any S3-compatible bucket</Strong>.
          </Copy>
          <Art>
            {/* The grid spans the panel; the tile is what is capped. Extra width on a wide card
                goes into the spacing between tiles instead of inflating them, so the cluster fills
                the panel at every size while the tiles stay one size. */}
            <div className="grid grid-cols-4 justify-items-center gap-2">
              {STORAGE_ICONS.map((Icon, index) => (
                <div
                  key={index}
                  aria-hidden="true"
                  className="grid aspect-square w-full max-w-[3.4rem] place-items-center rounded-lg border border-border bg-card"
                >
                  <Icon className="h-[18px] w-[18px] text-muted-foreground/50" />
                </div>
              ))}
            </div>
          </Art>
        </Card>

        <Card icon={<Workflow />} title="Workflows">
          <Copy>
            <Strong>Drag nodes to route data</Strong> — validate, transform, persist, notify.
          </Copy>
          <Art>
            <div className="grid gap-2">
              <Tile>webhook → switch</Tile>
              <Tile dim>unwrap-bundle</Tile>
              <Tile dim>persist-store</Tile>
            </div>
          </Art>
        </Card>

        <Card icon={<Library />} title="Terminology">
          <Copy>
            Coding systems, value sets, and national dictionaries —{' '}
            <Strong>codes stay in one place</Strong>.
          </Copy>
          <Art>
            <div className="grid gap-2 font-mono text-[11.5px]">
              {[
                ['34714-6', 'INR'],
                ['634-6', 'Isolate'],
                ['SNOMED', 'Specimen'],
              ].map(([code, label]) => (
                <div
                  key={code}
                  className="flex justify-between gap-2.5 rounded-lg border border-border bg-card px-2.5 py-1.5"
                >
                  <span className="text-primary">{code}</span>
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </Art>
        </Card>

        <Card icon={<Braces />} title="Data APIs">
          <Copy>
            <Strong>FHIR in, FHIR out.</Strong> Every resource is reachable over REST.
          </Copy>
          <Art>
            <div className="grid gap-1.5 font-mono text-[11.5px]">
              {[
                ['Patient', '/fhir/Patient'],
                ['Specimen', '/fhir/Specimen'],
                ['Report', '/api/reports'],
              ].map(([resource, endpoint]) => (
                <div key={resource} className="flex items-center gap-2">
                  <span className="whitespace-nowrap rounded border border-border bg-card px-2 py-1 text-muted-foreground">
                    {resource}
                  </span>
                  <span aria-hidden="true" className="min-w-2 flex-1 border-t border-dashed border-border" />
                  <span className="whitespace-nowrap rounded border border-border bg-card px-2 py-1 text-foreground">
                    {endpoint}
                  </span>
                </div>
              ))}
            </div>
          </Art>
        </Card>
      </div>
    </div>
  );
}
