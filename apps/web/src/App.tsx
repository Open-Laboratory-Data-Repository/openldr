import { Routes, Route, Link } from 'react-router-dom';
import { Hero } from '@/components/Hero';
import { WorkflowPreview } from '@/components/WorkflowPreview';
import { FeatureGrid } from '@/components/FeatureGrid';
import { MarketplaceTable } from '@/components/MarketplaceTable';
import { Gallery } from '@/components/Gallery';
import { InstallBlock } from '@/components/InstallBlock';
import { Footer } from '@/components/Footer';
import { GitHubLink } from '@/components/GitHubLink';
import { DocsPage } from '@/docs/DocsPage';
import { ChangelogPage } from '@/changelog/ChangelogPage';

function Landing() {
  return (
    <>
      <Hero />
      {/* Full-bleed rules separate the landing sections, matching the header and footer. */}
      <div className="border-t border-border">
        <FeatureGrid />
      </div>
      <div className="border-t border-border">
        {/* Same heading-plus-subtitle block as the feature section above, so the two landing
            sections introduce themselves the same way. */}
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Build your own workflows</h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Drag nodes to decide how each payload is routed, checked, and stored
            </p>
          </div>
          <WorkflowPreview />
        </div>
      </div>
      <div className="border-t border-border">
        <MarketplaceTable />
      </div>
      <div className="border-t border-border">
        <Gallery />
      </div>
      <div className="border-t border-border">
        <InstallBlock />
      </div>
    </>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        {/* The mark is apps/web/public/favicon.svg — the same file the tab icon uses, so the two
            can never drift apart. */}
        <Link to="/" className="flex items-center gap-2 text-base font-semibold text-foreground">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
          OpenLDR
        </Link>
        <nav className="flex items-center gap-4 text-sm" aria-label="Primary">
          <Link to="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
          <Link to="/changelog" className="text-muted-foreground hover:text-foreground">Changelog</Link>
          <a href="/studio/" className="text-muted-foreground hover:text-foreground">Studio</a>
          <GitHubLink />
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:page" element={<DocsPage />} />
          <Route path="/changelog" element={<ChangelogPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
