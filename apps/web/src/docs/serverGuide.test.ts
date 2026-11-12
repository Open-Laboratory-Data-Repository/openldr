import { describe, expect, it } from 'vitest';
import { docPage } from './content';
import { SERVER_COMMANDS, serverMarkdown, serverScene } from './serverGuide';

describe('Windows Server guide', () => {
  for (const locale of ['en', 'fr', 'pt'] as const) {
    it(`keeps each ${locale} step paired with its copyable command and illustration`, () => {
      const markdown = serverMarkdown(docPage('windows-server', '0.1.8', locale)!.body);
      expect(markdown).not.toContain('{{server:');
      const steps = markdown.split(/(?=^#{2,3} )/m).filter(section => /^### \d+\./.test(section));
      expect(steps).toHaveLength(Object.keys(SERVER_COMMANDS).length);
      for (const section of steps) {
        const image = section.match(/!\[[^\]]+\]\((guide:server-[a-z-]+)\)/)?.[1];
        expect(image).toBeTruthy();
        const scene = serverScene(image!);
        expect(scene).not.toBeNull();
        expect(section).toContain(SERVER_COMMANDS[scene!]);
      }
      expect(markdown).not.toContain('/docs-images/install/sign-in.png');
    });
  }

  it('rejects unknown command and illustration identifiers', () => {
    expect(serverScene('javascript:server-wsl-install')).toBeNull();
    expect(serverScene('guide:server-unknown')).toBeNull();
    expect(() => serverMarkdown('{{server:unknown}}')).toThrow('Unknown Windows Server command');
  });

  it('leaves archived content unchanged', () => {
    const source = docPage('windows-server', '0.1.0', 'en')?.body ?? '# Windows Server';
    expect(serverMarkdown(source)).toBe(source);
  });
});
