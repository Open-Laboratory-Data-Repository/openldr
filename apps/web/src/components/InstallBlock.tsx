import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

// Served from raw GitHub until the landing has a stable domain; then switch to
// https://<domain>/install.sh and /install.ps1.
const BASE = 'https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install';
const COMMANDS: Record<string, string> = {
  unix: `curl -fsSL ${BASE}/install.sh | bash`,
  windows: `irm ${BASE}/install.ps1 | iex`,
  // Inside a WSL2 distro you're on Linux, so it's the same shell installer as unix.
  wsl: `curl -fsSL ${BASE}/install.sh | bash`,
};

function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async () => {
    if (!navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }

    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button variant="ghost" size="icon" aria-label="Copy command" onClick={copy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function CommandRow({ command }: { command: string }) {
  return (
    <div className="px-5 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="m-0 text-sm font-semibold text-foreground">Installation command</p>
        <CopyCommandButton command={command} />
      </div>
      <code className="block min-w-0 overflow-x-auto whitespace-nowrap rounded-md border border-primary/30 bg-primary/5 px-4 py-4 font-mono font-medium text-foreground">{command}</code>
    </div>
  );
}

function PlatformNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border bg-muted/40 px-5 py-4">
      <p className="m-0 text-sm font-semibold text-foreground">Platform requirements</p>
      <p className="mb-0 mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

export function InstallBlock() {
  const [activeCommand, setActiveCommand] = useState('unix');

  return (
    <section
      id="install"
      aria-label="OpenLDR installation"
      className="mx-auto max-w-6xl px-6 py-20 text-center"
    >
      {/* Same heading-plus-subtitle block as the two sections above. This is also where the hero's
          "Get started" button scrolls to, so the heading has to confirm the reader arrived. */}
      <div className="mx-auto mb-12 max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight">Install in one line</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Requires Docker. The installer brings up the full stack locally
        </p>
      </div>

      <div
        aria-label="OpenLDR install command"
        className="mx-auto w-full overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm"
      >
        <Tabs value={activeCommand} onValueChange={setActiveCommand} className="relative w-full">
          <TabsList className="h-auto w-full max-w-full overflow-x-auto border-b border-border px-4 py-3">
            <TabsTrigger
              value="unix"
              className="rounded-md border-b-0 px-3 data-[state=active]:border-b-0 data-[state=active]:bg-background"
            >
              Linux / macOS
            </TabsTrigger>
            <TabsTrigger
              value="windows"
              className="rounded-md border-b-0 px-3 data-[state=active]:border-b-0 data-[state=active]:bg-background"
            >
              Windows
            </TabsTrigger>
            <TabsTrigger
              value="wsl"
              className="rounded-md border-b-0 px-3 data-[state=active]:border-b-0 data-[state=active]:bg-background"
            >
              Windows Server
            </TabsTrigger>
          </TabsList>
          <TabsContent value="unix">
            <CommandRow command={COMMANDS.unix} />
            <PlatformNote>Run in a terminal on Linux or macOS with Docker installed.</PlatformNote>
          </TabsContent>
          <TabsContent value="windows">
            <CommandRow command={COMMANDS.windows} />
            <PlatformNote>Run in PowerShell on Windows 10/11 with Docker Desktop installed.</PlatformNote>
          </TabsContent>
          <TabsContent value="wsl">
            <CommandRow command={COMMANDS.wsl} />
            <PlatformNote>
              Install Docker CE inside a WSL2 Ubuntu distro or a Hyper-V virtual machine
              on Windows Server. Run the command in that Linux environment.{' '}
              <Link to="/docs/windows-server" className="text-foreground underline underline-offset-4">
                Windows Server setup guide
              </Link>
              .
            </PlatformNote>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
