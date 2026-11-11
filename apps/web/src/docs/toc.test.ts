import { describe, expect, it } from 'vitest';
import { extractToc, plainHeading, wantsToc } from './toc';

describe('extractToc', () => {
  it('lists h2 and h3 with the ids DocMarkdown gives them', () => {
    const md = '# Title\n\n## Load the sample data\n\n### Turn on SQL widgets\n\n## Example 1: filter it\n';
    expect(extractToc(md)).toEqual([
      { id: 'load-the-sample-data', text: 'Load the sample data', level: 2 },
      { id: 'turn-on-sql-widgets', text: 'Turn on SQL widgets', level: 3 },
      { id: 'example-1-filter-it', text: 'Example 1: filter it', level: 2 },
    ]);
  });

  it('numbers repeated headings and skips code blocks', () => {
    const md = '## Steps\n\n```bash\n## not a heading\n```\n\n## Steps\n';
    expect(extractToc(md).map((e) => e.id)).toEqual(['steps', 'steps-1']);
  });

  it('strips emphasis, code ticks and link targets from heading text', () => {
    expect(plainHeading('Use **`{{period_from}}`** in [SQL](/docs/query)')).toBe('Use {{period_from}} in SQL');
  });

  it('takes accents off French and Portuguese headings', () => {
    expect(extractToc('## Exemple 1 : filtrer les données\n## Gráficos e opções\n').map((e) => e.id)).toEqual([
      'exemple-1-filtrer-les-donnees',
      'graficos-e-opcoes',
    ]);
  });

  it('wants a list only for pages with three or more sections', () => {
    expect(wantsToc(extractToc('## A\n## B\n'))).toBe(false);
    expect(wantsToc(extractToc('## A\n## B\n## C\n'))).toBe(true);
  });
});
