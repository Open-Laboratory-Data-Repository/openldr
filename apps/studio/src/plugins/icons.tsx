import type { ComponentType } from 'react';
import { Puzzle, Share2, BarChart3, Database, Plug, Settings, FileText, type LucideIcon } from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  puzzle: Puzzle, 'share-2': Share2, 'bar-chart-3': BarChart3, database: Database, plug: Plug, settings: Settings, 'file-text': FileText,
};

/** Resolve a manifest nav icon name to a lucide component, falling back to Puzzle. */
export function pluginIcon(name: string | undefined): LucideIcon {
  return (name && MAP[name]) || Puzzle;
}

/** An icon component the sidebar can draw at its own size. */
export type NavIcon = ComponentType<{ className?: string }>;

// The same check the manifest makes at install, repeated so a bad value from any server never
// reaches the DOM. Path commands, numbers and separators only.
const SVG_PATH_D = /^\s*[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const MAX_PATHS = 8;
const MAX_PATH_LENGTH = 1000;

function usablePaths(paths: unknown): string[] | null {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) return null;
  for (const d of paths) {
    if (typeof d !== 'string' || d.length === 0 || d.length > MAX_PATH_LENGTH || !SVG_PATH_D.test(d)) return null;
  }
  return paths as string[];
}

// One component per distinct icon, so a sidebar re-render does not remount the svg.
const drawn = new Map<string, NavIcon>();

/**
 * The sidebar icon for a plugin. A plugin's own `iconPaths` win: each string becomes one `<path d>`
 * in an svg Studio owns, with Studio's colour (`currentColor`), a 2-unit stroke and round caps and
 * joins on a 24x24 grid. Without usable paths it falls back to the named icon, then to Puzzle.
 * The svg is decorative; the link keeps its name from the plugin label.
 */
export function pluginNavIcon(nav: { icon?: string; iconPaths?: unknown }): NavIcon {
  const paths = usablePaths(nav.iconPaths);
  if (!paths) return pluginIcon(nav.icon);
  const key = JSON.stringify(paths);
  let Icon = drawn.get(key);
  if (!Icon) {
    const PathIcon: NavIcon = ({ className }) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
        data-plugin-icon=""
      >
        {paths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    );
    Icon = PathIcon;
    drawn.set(key, Icon);
  }
  return Icon;
}
