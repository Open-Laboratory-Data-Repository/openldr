import { useEffect, useState } from 'react';
import { listPluginUis, type PluginUiEntry } from '@/api';
import { Card } from '@/components/ui/card';
import { PluginFrame, pluginFrameContext } from './PluginFrame';

// Fixed heights: a sandboxed iframe cannot size itself to its content.
const HEIGHT_PX = { small: 160, medium: 240, large: 360 } as const;

/** The row of plugin cards under the home dashboard grid, one per plugin that declares a widget
 *  (and that an admin has not switched off). In manifest order. Renders nothing when there are none,
 *  or when the plugin list cannot be read: the dashboard itself must never fail because of it. */
export function PluginWidgets() {
  const [entries, setEntries] = useState<PluginUiEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listPluginUis()
      .then((list) => { if (!cancelled) setEntries(Array.isArray(list) ? list.filter((e) => e.sites?.widget) : []); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, []);

  if (entries.length === 0) return null;
  return (
    <section className="grid gap-4 px-4 pb-4 md:grid-cols-2" data-testid="plugin-widgets">
      {entries.map((e) => {
        const w = e.sites!.widget!;
        return (
          <Card key={e.id} className="flex min-w-0 flex-col overflow-hidden p-0">
            <div className="truncate border-b border-border px-4 py-2 text-sm font-medium">{w.title}</div>
            <div style={{ height: HEIGHT_PX[w.height] ?? HEIGHT_PX.medium }} data-testid={`plugin-widget-${e.id}`}>
              <PluginFrame pluginId={e.id} context={pluginFrameContext(e.id, 'widget')} />
            </div>
          </Card>
        );
      })}
    </section>
  );
}
