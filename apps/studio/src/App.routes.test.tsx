import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n/index';

// The real App routes, with each page swapped for a marker, so the test reads the gates
// App.tsx actually sets and not a copy of them.
let caps: string[] = [];
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me', username: 'me', displayName: null, roles: [] },
    loading: false,
    hasCapability: (c: string) => caps.includes(c),
    signOut: vi.fn(),
    authEnforced: true,
  }),
}));
vi.mock('./shell/UserPreferencesSync', () => ({
  UserPreferencesSync: () => null,
  StartPageGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// App imports every page; the PDF viewer needs browser APIs jsdom lacks.
vi.mock('./reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => null }));
vi.mock('./plugins/PluginPanelHost', () => ({ PluginPanelHost: () => null }));
vi.mock('./auth/AccessDeniedPage', () => ({ AccessDeniedPage: () => <div>access denied page</div> }));
vi.mock('./pages/Terminology', () => ({ Terminology: () => <div>terminology page</div> }));
vi.mock('./pages/Forms', () => ({ Forms: () => <div>forms page</div> }));
vi.mock('./pages/FormCapture', () => ({ FormCapture: () => <div>capture page</div> }));
vi.mock('./forms-builder/FormBuilderPage', () => ({ FormBuilderPage: () => <div>builder page</div> }));

import { App } from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  caps = [];
});

describe('App route gates for Terminology and Forms', () => {
  it('sends a user without terminology.view to Access denied', () => {
    caps = ['patients.view'];
    renderAt('/terminology');
    expect(screen.getByText('access denied page')).toBeInTheDocument();
    expect(screen.queryByText('terminology page')).not.toBeInTheDocument();
  });

  it('opens Terminology for a user with terminology.view', () => {
    caps = ['terminology.view'];
    renderAt('/terminology');
    expect(screen.getByText('terminology page')).toBeInTheDocument();
  });

  it.each(['/forms', '/forms/f1', '/forms/f1/builder', '/forms/new'])(
    'sends a user without forms capabilities from %s to Access denied',
    (path) => {
      caps = ['patients.view'];
      renderAt(path);
      expect(screen.getByText('access denied page')).toBeInTheDocument();
    },
  );

  it('opens the forms list for a user with forms.view', () => {
    caps = ['forms.view'];
    renderAt('/forms');
    expect(screen.getByText('forms page')).toBeInTheDocument();
  });

  it('opens a form for capture with forms.view', () => {
    caps = ['forms.view'];
    renderAt('/forms/f1');
    expect(screen.getByText('capture page')).toBeInTheDocument();
  });

  it('opens an existing form in the builder with forms.view', () => {
    caps = ['forms.view'];
    renderAt('/forms/f1/builder');
    expect(screen.getByText('builder page')).toBeInTheDocument();
  });

  it('opens a new form only for a user with forms.edit', () => {
    caps = ['forms.view'];
    renderAt('/forms/new');
    expect(screen.getByText('access denied page')).toBeInTheDocument();
    caps = ['forms.view', 'forms.edit'];
    renderAt('/forms/new');
    expect(screen.getByText('builder page')).toBeInTheDocument();
  });

  it('keeps Docs open to every signed-in user', () => {
    caps = [];
    renderAt('/docs');
    expect(screen.queryByText('access denied page')).not.toBeInTheDocument();
  });
});
