import { describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS } from '@openldr/rbac';
import { mayReadGuide } from './access';
import { DOC_GUIDES } from './registry';

// The docs list shows only the guides a person can use (design 2026-11-18-roles-scope, part 4).
describe('mayReadGuide', () => {
  const holds = (...caps: string[]) => (c: string) => caps.includes(c);

  it('shows a guide that names no permission to everyone', () => {
    expect(mayReadGuide({ requiredCapabilities: undefined }, holds())).toBe(true);
    expect(mayReadGuide({ requiredCapabilities: [] }, holds())).toBe(true);
  });

  it('shows a guide that names permissions to a person holding any one of them', () => {
    const guide = { requiredCapabilities: ['reports.view', 'reports.edit_templates'] };
    expect(mayReadGuide(guide, holds('reports.edit_templates'))).toBe(true);
    expect(mayReadGuide(guide, holds('dashboards.view'))).toBe(false);
  });
});

describe('the guides\' permissions', () => {
  it('name only permissions that exist', () => {
    const known = new Set(CAPABILITY_KEYS);
    for (const guide of DOC_GUIDES) {
      for (const cap of guide.requiredCapabilities ?? []) expect(known.has(cap), `${guide.slug}: ${cap}`).toBe(true);
    }
  });

  it('match the page each guide documents, and leave setup and personal guides open', () => {
    const caps = (slug: string) => DOC_GUIDES.find((g) => g.slug === slug)?.requiredCapabilities ?? [];
    expect(caps('dashboard')).toEqual(['dashboards.view']);
    expect(caps('reports')).toEqual(['reports.view']);
    expect(caps('audit')).toEqual(['audit.view']);
    for (const open of ['start-here', 'first-run', 'sign-in', 'user-preferences', 'upgrading']) expect(caps(open), open).toEqual([]);
    // Review D1-D3: the guide follows where its steps happen and who can open that page.
    expect(caps('report-pipeline')).toEqual(['workflows.view']);
    expect(caps('plugin-sites')).toEqual([]);
    // The Terminology page has needed terminology.view since 2026-11-23, so its guide follows it.
    expect(caps('terminology')).toEqual(['terminology.view']);
    // Each Settings guide follows the route gate of its page (App.tsx).
    expect(caps('layouts')).toEqual(['settings.edit_general']);
    expect(caps('setup-checks')).toEqual(['settings.view']);
    expect(caps('laboratory')).toEqual(['settings.view']);
  });
});
