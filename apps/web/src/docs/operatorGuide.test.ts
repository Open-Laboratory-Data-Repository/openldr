import { describe, expect, it } from 'vitest';
import { docPage } from './content';
import { OPERATOR_PAGES, OPERATOR_PLATFORM_MARKER, operatorExample, operatorMarkdown } from './operatorGuide';

describe('Reviewed operator guides', () => {
  for (const page of OPERATOR_PAGES) {
    for (const lang of ['en', 'fr', 'pt'] as const) {
      it(`resolves the ${page} ${lang} examples without putting terminal prompts in copyable text`, () => {
        const source = docPage(page, '0.1.8', lang)!.body;
        if (!source.includes(OPERATOR_PLATFORM_MARKER)) return;
        for (const platform of ['unix', 'windows'] as const) {
          const rendered = operatorMarkdown(source, platform);
          expect(rendered).not.toContain('{{operator:');
          expect(rendered).not.toContain(OPERATOR_PLATFORM_MARKER);
          for (const match of rendered.matchAll(/\]\((guide:operator-[a-z0-9-]+)\)/g)) {
            expect(operatorExample(match[1])).not.toBeNull();
          }
          const steps = rendered.split(/(?=^#{2,3} )/m).filter(section => /^### \d+\./.test(section));
          for (const step of steps) expect(step).toMatch(/!\[[^\]]+\]\(/);
          expect(rendered).not.toContain('operator@workstation:');
        }
      });
    }
  }
  it('does not accept arbitrary media schemes or unknown example names', () => {
    expect(operatorExample('javascript:operator-upgrade-health')).toBeNull();
    expect(operatorExample('guide:operator-does-not-exist')).toBeNull();
    expect(() => operatorMarkdown('{{operator:does-not-exist}}', 'unix')).toThrow('Unknown operator illustration');
  });
});
