import { describe, expect, it } from 'vitest';
import { cliPlatformMarkdown } from './cliPlatform';
import { resolve } from './registry';
import { SCREENSHOTS } from './screenshots';
import { markdownImages } from './validation';
import { parseBlocks } from './export/docModel';

describe('CLI walkthrough platforms', () => {
  for (const locale of ['en', 'fr', 'pt'] as const) {
    it(`keeps ${locale} commands and images consistent for each platform`, () => {
      const content = resolve(locale, 'start-here')!.content;
      for (const platform of ['linux', 'mac', 'windows'] as const) {
        const rendered = cliPlatformMarkdown(content, platform);
        for (const image of markdownImages(rendered)) expect(SCREENSHOTS[image.src], image.src).toBeTruthy();
        expect(rendered).not.toMatch(/<!-- cli:/);
        expect(rendered).toContain('pnpm openldr ingest files/my-file.json');
        if (platform === 'windows') {
          expect(rendered).toContain('cd C:\\openldr_ce');
          expect(rendered).toContain('.\\openldr.ps1 --help');
          expect(rendered).toContain('Get-ChildItem -Name');
          expect(rendered).not.toContain('~/Downloads/openldr_ce');
          expect(rendered).not.toContain('./openldr');
          expect(rendered).not.toContain('terminal-linux-');
        } else {
          expect(rendered).toContain('cd ~/Downloads/openldr_ce');
          expect(rendered).toContain('./openldr --help');
        }
      }
    });
  }
  it('exports a readable Linux walkthrough without platform comments', () => {
    const content = resolve('en', 'start-here')!.content;
    const text = JSON.stringify(parseBlocks(content));
    expect(text).not.toContain('cli-platform');
    expect(text).not.toContain('<!--');
    expect(text).toContain('cd ~/Downloads/openldr_ce');
    expect(text).not.toContain('C:\\\\openldr_ce');
  });
  it('leaves ordinary documentation unchanged', () => {
    expect(cliPlatformMarkdown('# Guide\n\n`./openldr`', 'windows')).toBe('# Guide\n\n`./openldr`');
  });
});
