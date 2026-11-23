import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { Docs } from './Docs';

// Review focus 5 of the lab plugin step 1 plan. These tests use the real docs registry, so a link
// to a guide CE no longer ships (the Reception guide moved out with the Reception desk) shows the
// not-found panel instead of crashing the page.
vi.mock('../auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('../auth/AuthProvider')>()),
  useAuth: () => ({ user: null, loading: false, hasCapability: () => true, signOut: () => {}, authEnforced: true, authMode: 'oidc' }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:slug" element={<Docs />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a link to a guide CE does not ship', () => {
  it('shows the not-found panel for the removed reception guide', () => {
    renderAt('/docs/reception');
    expect(screen.getByText(/Documentation page not found\./)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Reception' })).toBeNull();
  });

  it('shows the not-found panel for a slug that never existed', () => {
    renderAt('/docs/no-such-guide');
    expect(screen.getByText(/Documentation page not found\./)).toBeInTheDocument();
  });

  it('still opens the lab setup guide', () => {
    renderAt('/docs/lab-setup');
    expect(screen.queryByText(/Documentation page not found\./)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Lab setup' })).toBeInTheDocument();
  });
});
