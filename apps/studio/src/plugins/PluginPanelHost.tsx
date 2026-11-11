import { useEffect } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PluginFrame, pluginFrameContext } from './PluginFrame';
import { closePluginPanel, usePluginPanel } from './pluginPanel';

/** A plugin's right side panel. Mounted once in App.tsx, outside the page routes, so it stays open
 *  and its iframe is not reloaded while the user moves between pages. Non-modal and without a
 *  backdrop, so the page beside it keeps working. Sits under the 3rem app header so the header's
 *  buttons stay reachable; full width on a phone. */
export function PluginPanelHost() {
  const open = usePluginPanel();
  const { user } = useAuth();

  // A panel belongs to the signed-in user's session; never carry it over a sign-out.
  useEffect(() => { if (!user) closePluginPanel(); }, [user]);

  if (!open || !user) return null;
  return (
    <Sheet open modal={false} onOpenChange={(o) => { if (!o) closePluginPanel(); }}>
      <SheetContent
        hideOverlay
        aria-describedby={undefined}
        // Clicking the page beside the panel must not close it.
        onInteractOutside={(e) => e.preventDefault()}
        className="top-12 h-auto w-full max-w-full gap-0 p-0 md:w-96"
        data-testid="plugin-panel"
      >
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="truncate pr-6 text-sm">{open.title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          <PluginFrame key={open.id} pluginId={open.id} context={pluginFrameContext(open.id, 'panel')} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
