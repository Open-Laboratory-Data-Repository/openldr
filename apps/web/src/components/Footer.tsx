export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8 text-center text-sm text-muted-foreground">
      <p>
        {/* No licence named here — the repository is the source of truth for it, and a licence
            printed on the site is one more place to forget to update if it ever changes. */}
        OpenLDR CE · <a href="https://github.com/Open-Laboratory-Data-Repository/openldr">GitHub</a>
      </p>
    </footer>
  );
}
