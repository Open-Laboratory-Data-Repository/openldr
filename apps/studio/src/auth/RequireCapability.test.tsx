import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireCapability } from './RequireCapability';

vi.mock('./AuthProvider', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from './AuthProvider';

function renderAt(caps: string[] | null, loading = false) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: caps ? { id: 'u', username: 'u', displayName: null, roles: [] } : null,
    loading,
    hasCapability: (c: string) => caps?.includes(c) ?? false,
  });
  return render(
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/access-denied" element={<div>access denied</div>} />
        <Route path="/users" element={<RequireCapability cap="users.view"><div>admin-page</div></RequireCapability>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireCapability', () => {
  it('renders children for a user with the capability', () => {
    renderAt(['users.view']);
    expect(screen.getByText('admin-page')).toBeTruthy();
  });
  it('sends a signed-in user without the capability to access denied, not home', () => {
    renderAt(['forms.view']);
    expect(screen.getByText('access denied')).toBeTruthy();
    expect(screen.queryByText('home')).toBeNull();
  });
  it('redirects an unauthenticated user to home', () => {
    renderAt(null);
    expect(screen.getByText('home')).toBeTruthy();
  });
  it('renders nothing while loading', () => {
    const { container } = renderAt(['users.view'], true);
    expect(container.textContent).toBe('');
  });
});
