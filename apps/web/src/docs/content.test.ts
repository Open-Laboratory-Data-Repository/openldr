import { DEFAULT_DOC_VERSION, DOC_VERSIONS, NAV, docPage, pageTitle } from './content';

const SLUGS = NAV.flatMap((item) => [item.slug, ...(item.children ?? [])]);
const headings = (markdown: string) => markdown.split('\n').filter((line) => /^#{1,3} /.test(line)).length;

describe('website docs content', () => {
  it('opens the newest version and keeps 0.1.0', () => {
    expect(DEFAULT_DOC_VERSION).toBe('0.1.8');
    expect(DOC_VERSIONS).toContain('0.1.0');
  });

  it('has every current page in English, French and Portuguese, with the same headings', () => {
    for (const slug of SLUGS) {
      const en = docPage(slug, DEFAULT_DOC_VERSION, 'en');
      expect(en?.localeUsed, slug).toBe('en');
      for (const locale of ['fr', 'pt'] as const) {
        const page = docPage(slug, DEFAULT_DOC_VERSION, locale);
        expect(page?.localeUsed, `${slug} ${locale}`).toBe(locale);
        expect(headings(page!.body), `${slug} ${locale}`).toBe(headings(en!.body));
      }
    }
  });

  it('documents local sign-in, its setup code and the admin password recovery in every language', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      const body = docPage('auth-providers', DEFAULT_DOC_VERSION, locale)!.body;
      expect(body, locale).toContain('AUTH_ADAPTER=local');
      expect(body, locale).toContain('openldr auth setup-code');
      expect(body, locale).toContain('openldr user reset-password <username> --force');
      const cli = docPage('cli', DEFAULT_DOC_VERSION, locale)!.body;
      expect(cli, locale).toContain('openldr user end-sessions <username>');
    }
  });

  it('documents the four profile steps and their rules in every language', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      const body = docPage('profile-packs', DEFAULT_DOC_VERSION, locale)!.body;
      for (const kind of ['needs', 'role', 'layout', 'form']) expect(body, `${locale} ${kind}`).toContain(`"kind": "${kind}"`);
      expect(body, locale).toContain('installing this pack needs the roles.manage capability');
      expect(body, locale).toContain('step list does not match pack.json');
      expect(body, locale).toContain('openldr market remove <pack-id> --force');
    }
    expect(pageTitle('profile-packs', '0.1.8', 'fr')).toBe('Packs de profil');
    expect(pageTitle('profile-packs', '0.1.8', 'pt')).toBe('Pacotes de perfil');
  });

  it('documents what a lab has, the rebuild command, the planned plugin and the upgrade notes, in every language', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      const body = docPage('lab-setup', DEFAULT_DOC_VERSION, locale)!.body;
      expect(body, locale).toContain('openldr lab requisitions rebuild --force');
      expect(body, locale).toContain({ en: '**Danger zone**', fr: '**Zone de danger**', pt: '**Zona de perigo**' }[locale]);
      expect(body, locale).toContain('**Lab order**');
      expect(body, locale).toContain('openldr roles doctor');
      expect(body, locale).toContain('OPENLDR_KEY');
      expect(body, locale).not.toContain('openldr lab sections');
      expect(body, locale).not.toContain('allow-self-authorise');
      expect(body, locale).not.toContain('Lab settings');
      const cli = docPage('cli', DEFAULT_DOC_VERSION, locale)!.body;
      expect(cli, locale).toContain('openldr lab requisitions rebuild --force');
      expect(cli, locale).not.toContain('allow-self-authorise');
      expect(cli, locale).not.toContain('lab.receive');
    }
    expect(pageTitle('lab-setup', '0.1.8', 'en')).toBe('Set up a lab');
    expect(pageTitle('lab-setup', '0.1.8', 'fr')).toBe('Configurer un laboratoire');
    expect(pageTitle('lab-setup', '0.1.8', 'pt')).toBe('Configurar um laboratório');
  });

  it('documents plugin tables, the four host functions, their capabilities and what is refused, in every language', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      const body = docPage('plugin-host-functions', DEFAULT_DOC_VERSION, locale)!.body;
      for (const fn of ['db_select', 'db_write', 'ce_read', 'fhir_emit']) expect(body, `${locale} ${fn}`).toContain(`## ${fn}`);
      for (const cap of ['host:db', 'host:ce-read', 'emit-fhir']) expect(body, `${locale} ${cap}`).toContain(`\`${cap}\``);
      expect(body, locale).toContain('"facilityColumn": "facility"');
      expect(body, locale).toContain('RESOURCE_TYPE_NOT_ALLOWED');
      expect(body, locale).toContain('`pg_catalog.pg_roles`');
      expect(body, locale).not.toContain('\u2014');
    }
    expect(pageTitle('plugin-host-functions', '0.1.8', 'en')).toBe('Plugin tables and host functions');
    expect(pageTitle('plugin-host-functions', '0.1.8', 'fr')).toBe('Tables et fonctions hôtes des plugins');
    expect(pageTitle('plugin-host-functions', '0.1.8', 'pt')).toBe('Tabelas e funções do anfitrião para plugins');
  });

  it('takes each page title from the file in the reader\'s language', () => {
    expect(pageTitle('upgrading', '0.1.8', 'en')).toBe('Planned upgrades');
    expect(pageTitle('upgrading', '0.1.8', 'fr')).toBe('Mises à niveau planifiées');
    expect(pageTitle('upgrading', '0.1.8', 'pt')).toBe('Atualizações planeadas');
  });

  it('falls back to English when an older version has no translation', () => {
    expect(docPage('install', '0.1.0', 'fr')?.localeUsed).toBe('en');
    expect(pageTitle('install', '0.1.0', 'fr')).toBe('Install');
  });

  it('has no page outside the sidebar', () => {
    expect(docPage('dashboard', DEFAULT_DOC_VERSION, 'en')).toBeNull();
  });

  it('keeps each existing guide URL available once after grouping the reading paths', () => {
    expect(new Set(SLUGS).size).toBe(SLUGS.length);
    expect(SLUGS).toEqual(expect.arrayContaining([
      'getting-started', 'desktop-app', 'requirements', 'install', 'windows-server', 'upgrading',
      'environment', 'auth-providers', 'load-data', 'map-to-fhir', 'connector-diagnose',
      'cli', 'cli-access', 'standalone', 'development', 'profile-packs', 'lab-setup',
    ]));
  });
});
