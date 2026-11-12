import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, matchPath, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';

export interface SidebarNavEntry {
  key: string;
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
}

/** A link's height (`h-9`), the gap between links (`gap-1`) and the nav's padding (`p-2`), in px. */
const ROW = 36;
const GAP = 4;
const PAD = 8;

/**
 * How many links fit in `height` px of nav, and whether the rest need the ⋯ menu. When they do not
 * all fit, the last slot holds the ⋯ button. An unknown height (0, before the first measure, or in a
 * test without layout) shows every link.
 */
export function navSlots(count: number, height: number): { shown: number; more: boolean } {
  if (height <= 0) return { shown: count, more: false };
  const slots = Math.max(1, Math.floor((height - 2 * PAD + GAP) / (ROW + GAP)));
  if (count <= slots) return { shown: count, more: false };
  return { shown: slots - 1, more: true };
}

// One sidebar entry. Active state is computed with useMatch and passed to NavLink as a
// STRING className. When collapsed the item is wrapped in a Tooltip via `asChild`, and
// Radix's Slot stringifies a FUNCTION className (dumping BOTH color classes into the class
// list → every icon rendered primary/blue). A resolved string className avoids that.
function SidebarNavItem({
  to, end, icon: Icon, label, collapsed, onNavigate,
}: { to: string; end?: boolean; icon: LucideIcon; label: string; collapsed: boolean; onNavigate?: () => void }) {
  const active = useMatch({ path: to, end: Boolean(end) }) != null;
  // `collapsed` is a desktop-only affordance: on mobile the sidebar is a full-width drawer that
  // always shows labels, so every collapse-driven style is scoped to `md:` and the label is kept
  // in the DOM (hidden only on the desktop-collapsed rail) rather than conditionally rendered.
  // `shrink-0`: a link keeps its height. Without it a short window squeezed every link down to
  // its 16px icon before the nav ran out of room.
  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={cn(
        'flex h-9 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-medium no-underline transition-colors',
        collapsed && 'md:justify-center md:px-0',
        active ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className={cn('truncate', collapsed && 'md:hidden')}>{label}</span>
    </NavLink>
  );
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="hidden md:block">{label}</TooltipContent>
    </Tooltip>
  ) : link;
}

/**
 * The sidebar's links. Every link keeps one size. When the window is too short for all of them, the
 * ones that do not fit move into a ⋯ menu at the bottom, so the nav never scrolls.
 */
export function SidebarNav({
  items, collapsed, onNavigate,
}: { items: SidebarNavEntry[]; collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { shown, more } = navSlots(items.length, height);
  const visible = items.slice(0, shown);
  const hidden = items.slice(shown);
  const isActive = (e: SidebarNavEntry) => matchPath({ path: e.to, end: Boolean(e.end) }, pathname) != null;
  const hiddenActive = hidden.some(isActive);

  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        aria-label={t('nav.more')}
        className={cn(
          'flex h-9 w-full shrink-0 items-center justify-start gap-3 rounded-md px-3 text-sm font-medium',
          collapsed && 'md:justify-center md:px-0',
          hiddenActive ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <MoreHorizontal className="h-4 w-4 shrink-0" />
        <span className={cn('truncate', collapsed && 'md:hidden')}>{t('nav.more')}</span>
      </Button>
    </DropdownMenuTrigger>
  );

  return (
    <nav
      ref={ref}
      aria-label={t('a11y.primaryNav', { defaultValue: 'Primary' })}
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2"
    >
      {visible.map((e) => (
        <SidebarNavItem key={e.key} to={e.to} end={e.end} icon={e.icon} label={e.label} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
      {more && (
        <DropdownMenu>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent side="right" className="hidden md:block">{t('nav.more')}</TooltipContent>
            </Tooltip>
          ) : trigger}
          <DropdownMenuContent side={collapsed ? 'right' : 'top'} align="end" className="max-h-[70dvh] w-52 overflow-y-auto">
            {hidden.map((e) => {
              const Icon = e.icon;
              return (
                <DropdownMenuItem
                  key={e.key}
                  className={cn(isActive(e) && 'text-primary')}
                  onSelect={() => { navigate(e.to); onNavigate?.(); }}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {e.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
