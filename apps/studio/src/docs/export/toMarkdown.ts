import { CLI_PLATFORM_MARKER, cliPlatformMarkdown } from '../cliPlatform';
import type { DocSection } from '../registry';

/** The raw markdown for one section. */
export function sectionToMarkdown(section: DocSection): string {
  return cliPlatformMarkdown(section.content, 'linux').replaceAll(CLI_PLATFORM_MARKER, '');
}

/** All sections concatenated in order, separated by a horizontal rule. */
export function manualToMarkdown(sections: DocSection[]): string {
  return sections.map((s) => sectionToMarkdown(s).trim()).join('\n\n---\n\n');
}
