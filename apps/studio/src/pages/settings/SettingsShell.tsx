import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SUB_NAV } from './settingsNav';

/**
 * Default landing page for bare `/settings`. The parent route admits anyone who
 * can reach at least one sub-page (see App.tsx), but not every such user can
 * reach `general` (that one needs `settings.view` specifically) — a hardcoded
 * `Navigate to="general"` would bounce e.g. a notifications-only actor straight
 * back out to "/" via that child route's own RequireCapability. Land on the
 * first sub-nav entry the current user actually has a capability for instead.
 */
export function SettingsIndexRedirect() {
  const { hasCapability } = useAuth();
  const first = SUB_NAV.find((item) => !item.caps || item.caps.some((c) => hasCapability(c)));
  return <Navigate to={first ? first.to : '/settings/general'} replace />;
}

/**
 * Settings shell with a left-hand section selector, mirroring corlix's
 * SettingsPage. The active sub-page renders in the right pane via <Outlet />.
 * New sections slot in by adding one SUB_NAV entry (settingsNav.ts) and one nested <Route> in
 * App.tsx — no further plumbing. The Marketplace UI (Phase 3 SP-4) lands here.
 */
export function SettingsShell() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const visible = SUB_NAV.filter((item) => !item.caps || item.caps.some((c) => hasCapability(c)));
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = visible.find((item) => pathname === item.to || pathname.startsWith(item.to + '/'));

  return (
    <AppShell title={t('settings.title')} fullBleed>
      {/* On a phone the section selector is a select above the content: eleven sections in a
          sideways strip showed four at a time and hid the rest off screen. From `md` up it is the
          familiar left-hand column. */}
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-border md:w-52 md:border-b-0 md:border-r">
          <div className="p-2 md:hidden">
            <Select value={current?.to ?? ''} onValueChange={(to) => navigate(to)}>
              <SelectTrigger data-testid="settings-section-select" className="w-full" aria-label={t('settings.title')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="w-[var(--radix-select-trigger-width)]">
                {visible.map((item) => <SelectItem key={item.to} value={item.to}>{t(item.labelKey)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <nav className="hidden flex-col gap-1 p-3 md:flex">
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-md px-3 py-2 text-sm no-underline transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        </aside>
        {/* `overflow-hidden`, NOT `overflow-y-auto`. Every settings page owns its own scroll
            region (General/NotificationPreferences/Connectors/DataExposure scroll their body,
            Sites its table, DistributedSync its tab panel). A scroller here as well made two
            nested ones: the outer could be scrolled independently of the inner, pushing a page's
            first controls out of view — Distributed sync then looked like it started at "Site ID"
            with the Enable/Direction/Central URL fields missing entirely. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="settings-outlet">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
