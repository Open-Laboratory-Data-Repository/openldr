export interface SubNavItem {
  labelKey: string;
  to: string;
  /** Capability gate. Missing means visible to everyone who can see /settings. */
  caps?: string[];
}

/** The Settings sections, in sub-nav order. Add a section here and as a nested route in App.tsx. */
export const SUB_NAV: SubNavItem[] = [
  { labelKey: 'settings.subNav.general', to: '/settings/general', caps: ['settings.view'] },
  { labelKey: 'settings.subNav.setup', to: '/settings/setup', caps: ['settings.view'] },
  { labelKey: 'settings.subNav.laboratory', to: '/settings/laboratory', caps: ['settings.view'] },
  { labelKey: 'settings.subNav.notifications', to: '/settings/notifications', caps: ['notifications.view'] },
  { labelKey: 'settings.subNav.sites', to: '/settings/sites', caps: ['sync.manage'] },
  { labelKey: 'settings.subNav.sync', to: '/settings/sync', caps: ['sync.view'] },
  { labelKey: 'settings.subNav.connectors', to: '/settings/connectors', caps: ['connectors.manage'] },
  { labelKey: 'settings.subNav.marketplace', to: '/settings/marketplace', caps: ['marketplace.view'] },
  { labelKey: 'settings.subNav.roles', to: '/settings/roles', caps: ['roles.view'] },
  { labelKey: 'settings.subNav.layouts', to: '/settings/layouts', caps: ['settings.edit_general'] },
  { labelKey: 'settings.subNav.dataExposure', to: '/settings/data-exposure', caps: ['data_exposure.manage'] },
];

/** Every capability that opens at least one Settings section. Holding any one of them is enough
 *  to reach /settings, so the route gate and the user-menu entry both read this list. */
export const SETTINGS_CAPS: string[] = [...new Set(SUB_NAV.flatMap((item) => item.caps ?? []))];
