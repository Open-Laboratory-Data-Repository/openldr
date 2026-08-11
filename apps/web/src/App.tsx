import { Routes, Route, Link } from 'react-router-dom';
import { Hero } from '@/components/Hero';
import { WorkflowPreview } from '@/components/WorkflowPreview';
import { InstallBlock } from '@/components/InstallBlock';
import { Footer } from '@/components/Footer';
import { DocsPage } from '@/docs/DocsPage';

function Landing() {
  return (
    <>
      <Hero />
      {/* Full-bleed rules separate the landing sections, matching the header and footer. */}
      <div className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground">
            Build your own workflows. Drag nodes to decide how each payload is routed, checked,
            and stored.
          </p>
          <div className="mt-10">
            <WorkflowPreview />
          </div>
        </div>
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
        <Link to="/" className="text-base font-semibold text-foreground">OpenLDR</Link>
        <nav className="flex items-center gap-4 text-sm" aria-label="Primary">
          <Link to="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
          <a href="/studio/" className="text-muted-foreground hover:text-foreground">Studio</a>
          <a href="https://github.com/Open-Laboratory-Data-Repository/openldr" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:page" element={<DocsPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
