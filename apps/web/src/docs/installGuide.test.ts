import { describe, expect, it } from 'vitest';
import { INSTALL_COMMANDS, installMarkdown, installScene } from './installGuide';
import { docPage } from './content';
import { hasWebFocus } from './WebFocusedScreenshot';

describe('Install guide', () => {
  for (const locale of ['en', 'fr', 'pt'] as const) {
    for (const platform of ['unix', 'windows'] as const) {
      it(`shows complete ${platform} commands and step images in ${locale}`, () => {
        const source = docPage('install', '0.1.8', locale)!.body;
        const markdown = installMarkdown(source, platform);
        expect(markdown).not.toContain('{{install:');
        expect(markdown).not.toContain('<!-- install-platform -->');
        expect(markdown).not.toMatch(/<!-- install:(unix|windows) -->/);
        expect(markdown).toContain(INSTALL_COMMANDS[platform].download);
        expect(markdown).toContain(INSTALL_COMMANDS[platform].run);
        if (platform === 'windows') expect(markdown).not.toContain('~/Downloads/openldr_ce');
        const steps = markdown.split(/(?=^#{2,3} )/m).filter(section => /^### \d+\./.test(section));
        expect(steps.length).toBe(34);
        const signIn = markdown.split(/^## /m).find(section => section.includes('/docs-images/operator/install-login-open.png'))!;
        expect(signIn.match(/^### /gm)).toHaveLength(6);
        expect(signIn).toContain('labadmin');
        expect(signIn).toContain('App sign-in');
        expect(signIn).toContain('Submit');
        for (const step of steps) {
          expect(step).toMatch(/!\[[^\]]+\]\(/);
          const image = step.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] ?? '';
          expect(installScene(image) !== null || hasWebFocus(image)).toBe(true);
        }
        for (const variant of ['remote', 'mssql-demo', 'mssql-existing', 'mysql-demo', 'mysql-existing'] as const) {
          expect(markdown).toContain(INSTALL_COMMANDS[platform][variant]);
        }
      });
    }
  }

  it('leaves archived guides unchanged', () => {
    const source = docPage('install', '0.1.0', 'en')!.body;
    expect(installMarkdown(source, 'windows')).toBe(source);
  });

  it('accepts only the named installation illustrations', () => {
    expect(installScene('guide:install-ready')).toBe('ready');
    expect(installScene('guide:install-unknown')).toBeNull();
    expect(installScene('javascript:install-ready')).toBeNull();
  });
});
