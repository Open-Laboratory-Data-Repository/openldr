import type { InstallPlatform } from './installGuide';

export interface OperatorExample {
  unix: string;
  windows?: string;
  file?: string;
  shell?: InstallPlatform;
}
const files = import.meta.glob('./operator-examples/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, OperatorExample>>;
const examples: Record<string, OperatorExample> = Object.assign({}, ...Object.values(files));
export const OPERATOR_PLATFORM_MARKER = '<!-- operator-platform -->';
export const OPERATOR_PAGES = ['upgrading', 'environment', 'auth-providers', 'load-data', 'v1-import', 'connector-diagnose', 'cli', 'development'];

export function operatorExample(src: string): OperatorExample | null {
  return src.startsWith('guide:operator-') ? examples[src.slice('guide:operator-'.length)] ?? null : null;
}
export function operatorText(example: OperatorExample, platform: InstallPlatform): string {
  return platform === 'windows' && example.windows !== undefined ? example.windows : example.unix;
}
export function operatorMarkdown(markdown: string, platform: InstallPlatform): string {
  return markdown.replaceAll(OPERATOR_PLATFORM_MARKER, '')
    .replace(/```([^\n]*)\n\{\{operator:([a-z0-9-]+)\}\}\n```/g, (block, language: string, id: string) => {
      const example = examples[id];
      if (!example?.file) return block;
      const name = example.file.split(',')[0];
      return `**\`${name}\`**\n\n\`\`\`${language}\n{{operator:${id}}}\n\`\`\``;
    })
    .replace(/!\[[^\]]*\]\((guide:operator-[a-z0-9-]+)\)/g, (image, src: string) => operatorExample(src)?.file ? '' : image)
    .replace(/\{\{operator:([a-z0-9-]+)\}\}/g, (_, id: string) => {
    const example = examples[id];
    if (!example) throw new Error(`Unknown operator illustration: ${id}`);
    return operatorText(example, platform);
  });
}
