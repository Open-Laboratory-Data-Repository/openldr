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
// The desktop app's installers sit beside the server's, under the same BASE.
const DESKTOP_COMMANDS: Record<string, string> = {
  linux: `curl -fsSL ${BASE}/desktop.sh | bash`,
  macos: `curl -fsSL ${BASE}/desktop.sh | bash`,
  windows: `irm ${BASE}/desktop.ps1 | iex`,
};

const TAB_TRIGGER_CLASS =
  'rounded-md border-b-0 px-3 data-[state=active]:border-b-0 data-[state=active]:bg-background';
const PANEL_CLASS =
  'mx-auto w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm';

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

function PanelHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-5 pt-5">
      <h3 className="m-0 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mb-0 mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

function DesktopGuideLink() {
  return (
    <>
      {' '}
      <Link to="/docs/desktop-app" className="text-foreground underline underline-offset-4">
        Desktop app guide
      </Link>
      .
    </>
  );
}

export function InstallBlock() {
  const [activeCommand, setActiveCommand] = useState('unix');
  const [activeDesktop, setActiveDesktop] = useState('linux');

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
          Two ways to install. Each takes one line.
        </p>
      </div>

      {/* Stacked on a phone, side by side from lg. Each panel is min-w-0 so a long command
          scrolls inside its own row and never widens the grid column or the page. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div aria-label="OpenLDR install command" className={PANEL_CLASS}>
          <PanelHeading title="Server, with Docker">
            The full stack on a server or a workstation. Requires Docker.
          </PanelHeading>
          <Tabs value={activeCommand} onValueChange={setActiveCommand} className="relative w-full">
            <TabsList className="h-auto w-full max-w-full overflow-x-auto border-b border-border px-4 py-3">
              <TabsTrigger value="unix" className={TAB_TRIGGER_CLASS}>
                Linux / macOS
              </TabsTrigger>
              <TabsTrigger value="windows" className={TAB_TRIGGER_CLASS}>
                Windows
              </TabsTrigger>
              <TabsTrigger value="wsl" className={TAB_TRIGGER_CLASS}>
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

        <div aria-label="OpenLDR desktop install command" className={PANEL_CLASS}>
          <PanelHeading title="Desktop app">
            One computer, no Docker. It runs OpenLDR in a window, with its own database.
          </PanelHeading>
          <Tabs value={activeDesktop} onValueChange={setActiveDesktop} className="relative w-full">
            <TabsList className="h-auto w-full max-w-full overflow-x-auto border-b border-border px-4 py-3">
              <TabsTrigger value="linux" className={TAB_TRIGGER_CLASS}>
                Linux
              </TabsTrigger>
              <TabsTrigger value="macos" className={TAB_TRIGGER_CLASS}>
                macOS
              </TabsTrigger>
              <TabsTrigger value="windows" className={TAB_TRIGGER_CLASS}>
                Windows
              </TabsTrigger>
            </TabsList>
            <TabsContent value="linux">
              <CommandRow command={DESKTOP_COMMANDS.linux} />
              <PlatformNote>
                On Ubuntu 24.04 and later it asks for the administrator password once, for the app's sandbox.
                <DesktopGuideLink />
              </PlatformNote>
            </TabsContent>
            <TabsContent value="macos">
              <CommandRow command={DESKTOP_COMMANDS.macos} />
              <PlatformNote>
                Apple silicon only. The app is not signed.
                <DesktopGuideLink />
              </PlatformNote>
            </TabsContent>
            <TabsContent value="windows">
              <CommandRow command={DESKTOP_COMMANDS.windows} />
              <PlatformNote>
                Windows 10 or 11, 64-bit. The app is not signed.
                <DesktopGuideLink />
              </PlatformNote>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
}
