import { DOCS_VERSION, compareVersions } from './version';

export type Locale = 'en' | 'fr' | 'pt';
export const LOCALES: Locale[] = ['en', 'fr', 'pt'];

export type DocGroupId = 'start' | 'daily-work' | 'data-design' | 'administration' | 'more';
export type DocAudience = 'all-users' | 'lab-users' | 'lab-managers' | 'administrators';
export type DocDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type DocStatus = 'published' | 'coming-soon';

export interface DocGroup {
  id: DocGroupId;
  title: string;
}

export interface DocGuide {
  slug: string;
  title: string;
  group: DocGroupId;
  summary: string;
  audience: DocAudience[];
  requiredRoles: string[];
  estimatedMinutes: number;
  difficulty: DocDifficulty;
  relatedSlugs: string[];
  screenshotNames: string[];
  /** Screenshots and clips made by a guide capture script (e2e/capture-guides/<slug>.guide.ts),
   *  not by the static screenshot manifest. A clip `x.mp4` always has its poster `x.png`. */
  capturedNames?: string[];
  status: DocStatus;
}

export interface DocSection extends DocGuide {
  content: string;
  localeUsed: Locale;
}

export const DOC_GROUPS: DocGroup[] = [
  { id: 'start', title: 'Start here' },
  { id: 'daily-work', title: 'Daily work' },
  { id: 'data-design', title: 'Data and design' },
  { id: 'administration', title: 'Administration' },
  { id: 'more', title: 'More' },
];

export const DOC_GUIDES: DocGuide[] = [
  {
    slug: 'start-here',
    title: 'Start Here',
    group: 'start',
    summary: 'Find your way around Studio, change the language, use the docs, and spend a first hour with the sample data.',
    audience: ['all-users'],
    requiredRoles: [],
    estimatedMinutes: 15,
    difficulty: 'beginner',
    relatedSlugs: ['dashboard', 'reports', 'advanced-docs'],
    screenshotNames: ['start-here-navigation.png', 'start-here-report-menu.png', 'start-here-parameters.png'],
    capturedNames: [
      'start-here-tour.png',
      'start-here-language.mp4',
      'start-here-docs.mp4',
      'start-here-docs-download.png',
      'start-here-phone-menu.png',
    ],
    status: 'published',
  },
  {
    slug: 'dashboard',
    title: 'Dashboards',
    group: 'daily-work',
    summary: 'Load sample data, read and filter dashboards, and build your own widgets with the Builder or SQL.',
    audience: ['all-users', 'lab-users', 'lab-managers'],
    requiredRoles: [],
    estimatedMinutes: 45,
    difficulty: 'beginner',
    relatedSlugs: ['reports', 'workflows', 'query', 'data-exposure', 'settings'],
    screenshotNames: ['dashboard-overview.png', 'dashboard-edit-widget.png'],
    capturedNames: [
      'dashboard-tour.png',
      'dashboard-filters.mp4',
      'dashboard-filters-result.png',
      'dashboard-new-widget.mp4',
      'dashboard-builder.png',
      'dashboard-chart-types.png',
      'dashboard-trend.mp4',
      'dashboard-number.mp4',
      'dashboard-layout.mp4',
      'dashboard-filter-add.mp4',
      'dashboard-filter-editor.png',
      'dashboard-raw-sql-setting.png',
      'dashboard-sql.mp4',
      'dashboard-sql-variables.mp4',
      'dashboard-filter-apply.mp4',
      'dashboard-menu-edit.png',
      'dashboard-delete-confirm.png',
      'dashboard-phone.png',
    ],
    status: 'published',
  },
  {
    slug: 'reports',
    title: 'Reports',
    group: 'daily-work',
    summary: 'Run reports on the sample data, read and export the result, and schedule a report.',
    audience: ['lab-users', 'lab-managers'],
    requiredRoles: [],
    estimatedMinutes: 30,
    difficulty: 'beginner',
    relatedSlugs: ['dashboard', 'audit', 'report-designer', 'query'],
    screenshotNames: ['reports-run-result.png', 'reports-history-schedules.png'],
    capturedNames: [
      'reports-tour.png',
      'reports-run.mp4',
      'reports-spreadsheet.png',
      'reports-history.png',
      'reports-turnaround.png',
      'reports-schedule.mp4',
      'reports-schedules.png',
      'reports-phone.png',
    ],
    status: 'published',
  },
  {
    slug: 'workflows',
    title: 'Workflows',
    group: 'data-design',
    summary: 'Get the Ingest webhook ready, send it a record, read the run, and build a workflow on the sample data.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager'],
    estimatedMinutes: 40,
    difficulty: 'intermediate',
    relatedSlugs: ['report-pipeline', 'reports', 'connectors', 'audit'],
    screenshotNames: ['workflows-list.png', 'workflow-builder.png', 'workflow-run-history.png'],
    capturedNames: [
      'workflows-tour.png',
      'workflows-ingest-secret.mp4',
      'workflows-ingest-panel.png',
      'workflows-history.mp4',
      'workflows-run-detail.png',
      'workflows-build.mp4',
      'workflows-build-output.png',
      'workflows-phone.png',
    ],
    status: 'published',
  },
  {
    slug: 'report-pipeline',
    title: 'Scheduled reports with workflows',
    group: 'data-design',
    summary: 'Query a database on a schedule, fill an Excel template, and email the report — with two workflows.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['workflows', 'connectors', 'reports'],
    screenshotNames: ['report-materialize-builder.png', 'report-excel-template.png'],
    status: 'published',
  },
  {
    slug: 'query',
    title: 'Custom Queries',
    group: 'data-design',
    summary: 'Browse warehouse tables, write SQL with parameters on the sample data, and save, group, export and import queries.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager', 'data_analyst'],
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    relatedSlugs: ['reports', 'report-designer', 'connectors'],
    screenshotNames: ['query-workbench.png', 'query-sql-editor.png'],
    capturedNames: [
      'query-tour.png',
      'query-browse.mp4',
      'query-write.mp4',
      'query-params.mp4',
      'query-params-sheet.png',
      'query-run-values.mp4',
      'query-save.mp4',
      'query-row-actions.png',
      'query-transfer-menu.png',
      'query-phone.png',
    ],
    status: 'published',
  },
  {
    slug: 'report-designer',
    title: 'Report Designer',
    group: 'data-design',
    summary: 'Design printable report templates, bind tables to queries, and publish them as reports.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager'],
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    relatedSlugs: ['reports', 'query', 'connectors'],
    screenshotNames: ['report-designer-canvas.png'],
    status: 'published',
  },
  {
    slug: 'forms',
    title: 'Forms',
    group: 'data-design',
    summary: 'Build, publish, and use forms for structured data capture.',
    audience: ['lab-users', 'lab-managers'],
    requiredRoles: [],
    estimatedMinutes: 18,
    difficulty: 'intermediate',
    relatedSlugs: ['terminology', 'marketplace'],
    screenshotNames: ['forms-list.png', 'form-builder.png', 'form-capture.png'],
    status: 'published',
  },
  {
    slug: 'terminology',
    title: 'Terminology',
    group: 'data-design',
    summary: 'Browse code systems and import terms, ValueSets, and ontology indexes.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['forms', 'audit'],
    screenshotNames: ['terminology-overview.png', 'terminology-import.png'],
    status: 'published',
  },
  {
    slug: 'facilities',
    title: 'Facilities',
    group: 'data-design',
    summary: 'Import a national facility list by mapping its columns and vocabulary onto the OpenLDR contract.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 12,
    difficulty: 'intermediate',
    relatedSlugs: ['terminology', 'audit'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'test-catalog',
    title: 'Test catalog',
    group: 'data-design',
    summary: 'Keep the national list of tests, and choose which of them this lab runs.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 8,
    difficulty: 'intermediate',
    relatedSlugs: ['terminology', 'facilities'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'patients',
    title: 'Patients',
    group: 'data-design',
    summary: 'Find a patient by any identifier, and see where they were tested. Identifiers are masked unless you may see them.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 15,
    difficulty: 'beginner',
    relatedSlugs: ['facilities', 'test-catalog', 'data-exposure'],
    screenshotNames: [],
    capturedNames: [
      'patients-list.png',
      'patients-sheet.mp4',
      'patients-sheet-detail.png',
      'patients-identifier-system.mp4',
      'patients-search.png',
      'patients-duplicates.png',
      'patients-phone.png',
    ],
    status: 'published',
  },
  {
    slug: 'users',
    title: 'Users and Roles',
    group: 'administration',
    summary: 'Manage user access, roles, account state, and feature visibility.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 12,
    difficulty: 'intermediate',
    relatedSlugs: ['roles', 'audit', 'settings'],
    screenshotNames: ['users-list.png', 'user-edit-roles.png'],
    capturedNames: ['users-tour.png', 'users-row-menu.png', 'users-edit-sheet.png', 'users-phone.png'],
    status: 'published',
  },
  {
    slug: 'roles',
    title: 'Roles',
    group: 'administration',
    summary: 'Build capability-based roles and understand the built-in system roles.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 10,
    difficulty: 'intermediate',
    relatedSlugs: ['users', 'audit', 'settings'],
    screenshotNames: [],
    capturedNames: ['roles-tour.png', 'roles-create.mp4'],
    status: 'published',
  },
  {
    slug: 'audit',
    title: 'Audit',
    group: 'administration',
    summary: 'Filter audit events and investigate user-visible changes.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 10,
    difficulty: 'intermediate',
    relatedSlugs: ['users', 'workflows'],
    screenshotNames: ['audit-filter.png', 'audit-event-detail.png'],
    capturedNames: ['audit-tour.png', 'audit-filter-workflow.mp4', 'audit-event.png'],
    status: 'published',
  },
  {
    slug: 'activity',
    title: 'Activity',
    group: 'daily-work',
    summary: 'Follow a payload from received to stored, and read its stages and status.',
    audience: ['lab-users', 'lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 10,
    difficulty: 'beginner',
    relatedSlugs: ['workflows', 'audit'],
    screenshotNames: [],
    capturedNames: ['activity-list.png', 'activity-detail.mp4'],
    status: 'published',
  },
  {
    slug: 'settings',
    title: 'Settings',
    group: 'administration',
    summary: 'Understand administrator settings and find focused configuration guides.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 5,
    difficulty: 'beginner',
    relatedSlugs: ['roles', 'connectors', 'marketplace', 'environment', 'sync'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'laboratory',
    title: 'Laboratory',
    group: 'administration',
    summary: 'Set report identity, the default facility register, and the laboratory time zone.',
    audience: ['administrators'],
    requiredRoles: [],
    estimatedMinutes: 10,
    difficulty: 'beginner',
    relatedSlugs: ['settings', 'facilities', 'reports'],
    screenshotNames: [],
    capturedNames: ['laboratory-identity.mp4', 'laboratory-letterhead.png'],
    status: 'published',
  },
  {
    slug: 'data-exposure',
    title: 'Data exposure',
    group: 'administration',
    summary: 'Set visibility for additional dashboard builder columns and understand SQL and connector limits.',
    audience: ['administrators'],
    requiredRoles: [],
    estimatedMinutes: 10,
    difficulty: 'intermediate',
    relatedSlugs: ['settings', 'dashboard', 'query', 'connectors', 'reports'],
    screenshotNames: [],
    capturedNames: ['data-exposure-tour.png', 'data-exposure-hide.mp4'],
    status: 'published',
  },
  {
    slug: 'sync',
    title: 'Distributed Sync',
    group: 'administration',
    summary: 'Connect labs to a central server: enroll sites, choose a sync mode, and monitor replication.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['settings', 'users', 'environment'],
    screenshotNames: ['sync-enroll-site.png', 'sync-settings-card.png'],
    status: 'published',
  },
  {
    slug: 'connectors',
    title: 'Connectors',
    group: 'administration',
    summary: 'Create, test, secure, and maintain external-system connectors.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['report-pipeline', 'settings', 'workflows', 'marketplace', 'query'],
    screenshotNames: ['connectors-list.png', 'connector-form.png'],
    capturedNames: ['connectors-tour.png', 'connectors-test.mp4', 'connectors-add.mp4', 'connectors-readonly-query.mp4', 'connectors-readonly-denied.png', 'connectors-test-failed.png', 'connectors-rotate.mp4'],
    status: 'published',
  },
  {
    slug: 'marketplace',
    title: 'Marketplace',
    group: 'administration',
    summary: 'Browse, install, configure, update, and remove supported artifacts.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['settings', 'connectors', 'forms'],
    screenshotNames: [
      'marketplace-browse.png',
      'marketplace-detail.png',
      'marketplace-registries.png',
    ],
    status: 'published',
  },
  {
    slug: 'auth-providers',
    title: 'Authentication providers',
    group: 'administration',
    summary: 'Configure OIDC sign-in, local access and issuer protection.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 10,
    difficulty: 'advanced',
    relatedSlugs: ['environment', 'users', 'sync'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'environment',
    title: 'Environment Variables',
    group: 'administration',
    summary: 'Reference for the environment variables that configure a deployment.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 8,
    difficulty: 'advanced',
    relatedSlugs: ['settings', 'connectors'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'upgrading',
    title: 'Planned upgrades',
    group: 'administration',
    summary: 'Stop writers, verify backups, migrate and check a planned upgrade.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 12,
    difficulty: 'advanced',
    relatedSlugs: ['settings', 'environment', 'workflows'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'advanced-docs',
    title: 'Deployment & Developer Docs',
    group: 'more',
    summary: 'Find deployment, configuration, CLI, and developer docs on the OpenLDR website.',
    audience: ['all-users'],
    requiredRoles: [],
    estimatedMinutes: 3,
    difficulty: 'advanced',
    relatedSlugs: ['start-here', 'settings'],
    screenshotNames: [],
    status: 'published',
  },
];

/** Navigation order; pages without authored markdown are omitted by list(). */
export const DOC_ORDER = DOC_GUIDES.map((guide) => guide.slug);

// Bundle authored versions and locales: ./<version>/<locale>/<slug>.md.
const files = import.meta.glob('./*/*/*.md', {
  query: '?raw', eager: true, import: 'default',
}) as Record<string, string>;

// BY_VERSION[version][locale][slug] = content
const BY_VERSION: Record<string, Record<string, Record<string, string>>> = {};
for (const [path, content] of Object.entries(files)) {
  const match = path.match(/\.\/([^/]+)\/([^/]+)\/([^/]+)\.md$/);
  if (!match) continue;
  const [, version, locale, slug] = match;
  ((BY_VERSION[version] ??= {})[locale] ??= {})[slug] = content;
}

export function firstHeading(md: string): string {
  const line = md.split('\n').find((candidate) => /^#\s+/.test(candidate.trim()));
  return line ? line.trim().replace(/^#\s+/, '').trim() : '';
}

/** Authored doc versions, newest first (discovered from the content folders). */
export const DOC_VERSIONS: string[] = Object.keys(BY_VERSION).sort((a, b) =>
  compareVersions(b, a),
);

/** The version to show by default: this release if it has authored docs, else the
 * newest authored version (so a release ahead of its docs still shows the latest). */
export const DEFAULT_DOC_VERSION: string =
  DOC_VERSIONS.find((version) => version === DOCS_VERSION) ?? DOC_VERSIONS[0] ?? DOCS_VERSION;

function localesForVersion(version: string): Record<string, Record<string, string>> {
  if (BY_VERSION[version]) return BY_VERSION[version];
  return BY_VERSION[DOC_VERSIONS[0]] ?? {};
}

export function resolve(
  locale: Locale,
  slug: string,
  version: string = DEFAULT_DOC_VERSION,
): DocSection | null {
  const guide = DOC_GUIDES.find((candidate) => candidate.slug === slug);
  if (!guide) return null;

  const locales = localesForVersion(version);
  const localized = locales[locale]?.[slug];
  const content = localized ?? locales.en?.[slug];
  if (content == null) return null;

  return {
    ...guide,
    title: firstHeading(content) || guide.title,
    content,
    localeUsed: localized != null ? locale : 'en',
  };
}

export function list(locale: Locale, version: string = DEFAULT_DOC_VERSION): DocSection[] {
  return DOC_GUIDES
    .map((guide) => resolve(locale, guide.slug, version))
    .filter((section): section is DocSection => section !== null);
}
