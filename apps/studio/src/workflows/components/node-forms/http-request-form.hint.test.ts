import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';

// The hint shows a template example in double braces. i18next uses the same braces for its own
// values, so the example is passed in as a value and must come out as typed.
describe('the HTTP step URL hint', () => {
  it.each(['en', 'fr', 'pt'])('keeps the template example and names Settings and the server setting, in %s', (lng) => {
    const text = i18n.t('workflows.httpUrlHint', { lng, example: '{{ $json.baseUrl }}/users' });
    expect(text).toContain('{{ $json.baseUrl }}/users');
    expect(text).toContain('WORKFLOW_HTTP_ALLOWLIST');
    expect(text).not.toContain('{{example}}');
    expect(text).not.toBe('workflows.httpUrlHint');
  });
});
