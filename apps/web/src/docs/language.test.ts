import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guessLanguage, selectLanguage } from './language';

const MARKED = `# Title

## English

### First

Hello, this is the English text and it is fine.

## Français

### Premier

Bonjour, voici le texte et il est pour vous dans la page.

## Português

### Primeiro

Olá, este é o texto que não é para os outros, com uma linha.
`;

describe('selectLanguage', () => {
  it("keeps only the reader's marked section and lifts its headings one level", () => {
    const fr = selectLanguage(MARKED, 'fr');
    expect(fr.markdown).toContain('## Premier');
    expect(fr.markdown).not.toContain('Hello');
    expect(fr.markdown).not.toContain('Olá');
    expect(fr.markdown).not.toContain('## Français');
    expect(fr.translated).toBe(true);
    expect(fr.partlyEnglish).toBe(false);
  });

  it('keeps an untranslated English section in every language, and says so', () => {
    const page = `${MARKED}\n## Only in English\n\nThis part is in English and it has not been translated to the others.\n`;
    const pt = selectLanguage(page, 'pt');
    expect(pt.markdown).toContain('## Primeiro');
    expect(pt.markdown).toContain('## Only in English');
    expect(pt.partlyEnglish).toBe(true);
  });

  it('leaves an English-only page untouched', () => {
    const page = '# T\n\n## One\n\nThis is the text of the page and it is in English.\n';
    const fr = selectLanguage(page, 'fr');
    expect(fr.translated).toBe(false);
    expect(fr.markdown.trim()).toBe(page.trim());
  });

  it('never splits on a heading inside a code block', () => {
    const page = '# T\n\n## One\n\nThis is the text and it is in English.\n\n```bash\n## not a heading\n```\n';
    expect(selectLanguage(page, 'en').markdown).toContain('## not a heading');
  });

  it('guesses each language from its small words', () => {
    expect(guessLanguage('This is the page and it is for the lab.')).toBe('en');
    expect(guessLanguage('Voici la page et elle est pour le laboratoire, dans les règles.')).toBe('fr');
    expect(guessLanguage('Esta é a página que não é para o laboratório, com os dados.')).toBe('pt');
  });

  it('leaves no French in the English view and no Portuguese in the French view of any page', () => {
    const dir = join(__dirname, '0.1.8');
    for (const file of readdirSync(dir)) {
      const markdown = readFileSync(join(dir, file), 'utf8');
      for (const lang of ['en', 'fr', 'pt'] as const) {
        const view = selectLanguage(markdown, lang).markdown;
        for (const paragraph of view.split(/\n{2,}/).filter((p) => p.length > 120 && !p.startsWith('```'))) {
          const found = guessLanguage(paragraph);
          // English is allowed anywhere: it is what an untranslated part falls back to.
          if (found && found !== 'en') expect(found, `${file} (${lang}): ${paragraph.slice(0, 60)}`).toBe(lang);
        }
      }
    }
  });
});
