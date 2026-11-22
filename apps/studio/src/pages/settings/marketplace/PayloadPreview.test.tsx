import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getRoleCatalog: vi.fn() };
});
import * as api from '@/api';
import { PayloadPreview } from './PayloadPreview';

beforeEach(() => {
  vi.clearAllMocks();
  (api.getRoleCatalog as ReturnType<typeof vi.fn>).mockResolvedValue({
    groups: [{ key: 'forms', label: 'Forms', capabilities: [
      { key: 'forms.view', group: 'forms', label: 'View forms', description: '' },
      { key: 'forms.submit', group: 'forms', label: 'Submit forms', description: '' },
    ] }],
  });
});

describe('PayloadPreview content pack', () => {
  it('lists one row per step with its name, count and label', () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [
        { kind: 'value-set', label: 'Specimen types', count: 12 },
        { kind: 'facility-register', label: 'National register', count: 3400 },
        { kind: 'custom-queries', label: 'Monthly reports', count: 5 },
      ],
    }} />);
    const rows = screen.getAllByTestId('pack-step');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Value set');
    expect(rows[0].textContent).toContain('12');
    expect(rows[0].textContent).toContain('Specimen types');
    expect(rows[1].textContent).toContain('Facility register');
    expect(rows[1].textContent).toContain('3400');
    expect(rows[2].textContent).toContain('Custom queries');
    expect(screen.queryByText(/packStep/)).toBeNull();
    expect(api.getRoleCatalog).not.toHaveBeenCalled();
  });

  it('shows the collection site steps as four lines, and a role line lists every capability by its label', async () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [
        { kind: 'role', label: 'Sample Clerk', count: 3 },
        { kind: 'layout', label: 'Collection site', count: 3 },
        { kind: 'form', label: 'Lab request', count: 1 },
        { kind: 'form', label: 'Sample dispatch', count: 1 },
      ],
      roles: [{ slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'forms.submit', 'patients.view'] }],
    }} />);
    const rows = screen.getAllByTestId('pack-step');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('Role');
    expect(rows[0].textContent).toContain('Sample Clerk');
    expect(rows[0].textContent).toContain('3 capabilities');
    expect(rows[1].textContent).toContain('Layout');
    expect(rows[1].textContent).toContain('Collection site');
    expect(rows[1].textContent).toContain('3 pages');
    expect(rows[2].textContent).toContain('Form');
    expect(rows[2].textContent).toContain('Lab request');
    expect(rows[3].textContent).toContain('Sample dispatch');
    expect(screen.queryByText(/packStep/)).toBeNull();

    fireEvent.click(screen.getByTestId('pack-role-toggle'));
    const caps = await screen.findByTestId('pack-role-capabilities');
    await waitFor(() => expect(caps.textContent).toContain('View forms'));
    expect(caps.textContent).toContain('Submit forms');
    // A key the catalog does not name shows as the key itself, never as nothing.
    expect(caps.textContent).toContain('patients.view');
  });

  it('with expandRoles, a role line shows its capabilities from the start', async () => {
    render(<PayloadPreview expandRoles payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [{ kind: 'role', label: 'Sample Clerk', count: 2 }],
      roles: [{ slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'forms.submit'] }],
    }} />);
    const caps = screen.getByTestId('pack-role-capabilities');
    await waitFor(() => expect(caps.textContent).toContain('View forms'));
    expect(caps.textContent).toContain('Submit forms');
    expect(screen.getByTestId('pack-role-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('without expandRoles, a role line starts folded', () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [{ kind: 'role', label: 'Sample Clerk', count: 2 }],
      roles: [{ slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'forms.submit'] }],
    }} />);
    expect(screen.queryByTestId('pack-role-capabilities')).toBeNull();
    expect(screen.getByTestId('pack-role-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('a layout line names its pages and the roles it is the default for', () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [
        { kind: 'role', label: 'Sample Clerk', count: 3 },
        { kind: 'layout', label: 'Collection site', count: 4 },
      ],
      roles: [{ slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view'] }],
      layouts: [{ key: 'collection-site', name: 'Collection site', pages: ['/forms', '/patients', '/docs', '/odd-page'], roles: ['sample-clerk'] }],
    }} />);
    const row = screen.getAllByTestId('pack-step')[1];
    expect(row.textContent).toContain('Collection site (Forms, Patients, Docs, /odd-page), default for Sample Clerk');
    expect(row.textContent).not.toContain('4 pages');
  });

  it('a layout line keeps the page count when the server sends no layouts', () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [{ kind: 'layout', label: 'Collection site', count: 3 }],
    }} />);
    expect(screen.getByTestId('pack-step').textContent).toContain('3 pages');
  });

  it('two role steps with one name each show their own capabilities', async () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [
        { kind: 'role', label: 'Clerk', count: 1 },
        { kind: 'role', label: 'Clerk', count: 1 },
      ],
      roles: [
        { slug: 'clerk-a', name: 'Clerk', capabilities: ['forms.view'] },
        { slug: 'clerk-b', name: 'Clerk', capabilities: ['forms.submit'] },
      ],
    }} />);
    fireEvent.click(screen.getAllByTestId('pack-role-toggle')[1]);
    const caps = await screen.findByTestId('pack-role-capabilities');
    await waitFor(() => expect(caps.textContent).toContain('Submit forms'));
    expect(caps.textContent).not.toContain('View forms');
  });

  it('a count of one reads in the singular', () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [
        { kind: 'needs', label: 'sample-tracking', count: 1 },
        { kind: 'role', label: 'Clerk', count: 1 },
        { kind: 'layout', label: 'Home', count: 1 },
      ],
    }} />);
    const rows = screen.getAllByTestId('pack-step');
    expect(rows[0].textContent).toContain('1 bundle');
    expect(rows[0].textContent).not.toContain('1 bundles');
    expect(rows[1].textContent).toContain('1 capability');
    expect(rows[1].textContent).not.toContain('1 capabilities');
    expect(rows[2].textContent).toContain('1 page');
    expect(rows[2].textContent).not.toContain('1 pages');
  });

  it('names the bundles a needs step waits for', () => {
    render(<PayloadPreview payload={{
      kind: 'content-pack', packSha256: 'a'.repeat(64),
      steps: [{ kind: 'needs', label: 'sample-tracking, whonet', count: 2 }],
    }} />);
    const row = screen.getByTestId('pack-step');
    expect(row.textContent).toContain('Needs');
    expect(row.textContent).toContain('sample-tracking, whonet');
    expect(row.textContent).toContain('2 bundles');
  });
});
