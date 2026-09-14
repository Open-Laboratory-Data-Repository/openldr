import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { AccessDeniedPage } from './AccessDeniedPage';

const signOut = vi.hoisted(() => vi.fn());
vi.mock('./AuthProvider', () => ({ useAuth: () => ({
  user: { id: 'review', username: 'review', displayName: null, roles: [] },
  loading: false, authEnforced: true, signOut, hasCapability: () => false,
}) }));
vi.mock('@/api', async (original) => ({
  ...await original<typeof import('@/api')>(),
  listPluginUis: vi.fn().mockResolvedValue([]),
}));

beforeEach(() => { signOut.mockClear(); });
afterEach(async () => { cleanup(); await i18n.changeLanguage('en'); });

it.each([
  ['en', "You don't have access to this page"],
  ['fr', "Vous n'avez pas accès à cette page"],
  ['pt', 'Não tem acesso a esta página'],
])('shows the translated denial message in %s', async (language, heading) => {
  await i18n.changeLanguage(language);
  render(<MemoryRouter><AccessDeniedPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  expect(screen.getAllByRole('banner')).toHaveLength(1);
});

it('keeps Docs reachable without granting Users access', async () => {
  render(<MemoryRouter initialEntries={['/access-denied']}><Routes>
    <Route path="/access-denied" element={<AccessDeniedPage />} />
    <Route path="/docs" element={<h1>Documentation destination</h1>} />
  </Routes></MemoryRouter>);
  expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Docs' }));
  expect(screen.getByRole('heading', { name: 'Documentation destination' })).toBeInTheDocument();
});

it('keeps sign-out available through the existing user menu', async () => {
  render(<MemoryRouter><AccessDeniedPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Open user menu for review' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledOnce();
});
