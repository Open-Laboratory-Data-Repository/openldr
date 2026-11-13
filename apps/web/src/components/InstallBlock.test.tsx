import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InstallBlock } from './InstallBlock';

// The block holds two panels. Each query looks inside one of them, because the
// tab list, the copy button and the curl prefix appear in both.
const serverPanel = () => within(screen.getByLabelText('OpenLDR install command'));
const desktopPanel = () => within(screen.getByLabelText('OpenLDR desktop install command'));

describe('InstallBlock', () => {
  it('shows the Linux/macOS curl command by default', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(serverPanel().getByText(/curl -fsSL/)).toBeInTheDocument();
    expect(serverPanel().getByText(/install\.sh \| bash/)).toBeInTheDocument();
  });

  it('shows the Windows PowerShell command when the Windows tab is selected', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    // Radix Tabs activates its trigger on mousedown (primary button), not on a
    // synthetic click, so jsdom's fireEvent.click never reaches the handler.
    // Exact name avoids also matching the "Windows Server" tab.
    fireEvent.mouseDown(serverPanel().getByRole('tab', { name: 'Windows' }), { button: 0, ctrlKey: false });
    expect(serverPanel().getByText(/irm/)).toBeInTheDocument();
    expect(serverPanel().getByText(/install\.ps1/)).toBeInTheDocument();
  });

  it('shows the Linux installer under the Windows Server tab, for either Linux host', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    fireEvent.mouseDown(serverPanel().getByRole('tab', { name: 'Windows Server' }), { button: 0, ctrlKey: false });
    expect(serverPanel().getByText(/install\.sh \| bash/)).toBeInTheDocument();
    // The guide covers WSL2 and Hyper-V, so the tab must not send readers to WSL2 alone.
    expect(serverPanel().getByText(/WSL2 Ubuntu distro or a Hyper-V virtual machine/i)).toBeInTheDocument();
    expect(serverPanel().getByRole('link', { name: 'Windows Server setup guide' })).toBeInTheDocument();
  });

  it('copies the active command to the clipboard', async () => {
    const original = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      render(<InstallBlock />, { wrapper: MemoryRouter });
      fireEvent.click(serverPanel().getByRole('button', { name: /copy/i }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('install.sh')));
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });

  it('labels the install section for page navigation', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: /openldr installation/i })).toHaveAttribute('id', 'install');
    expect(screen.queryByText('Install')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /install openldr in one line/i })).not.toBeInTheDocument();
  });

  it('keeps the command area shrinkable so long commands scroll within the row', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(serverPanel().getByText(/curl -fsSL/)).toHaveClass('min-w-0');
  });

  it('renders the command tabs inside a centered install panel', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: /openldr installation/i })).toHaveClass('text-center');
    expect(screen.getByLabelText('OpenLDR install command')).toContainElement(serverPanel().getByRole('tablist'));
    expect(screen.getByLabelText('OpenLDR install command')).toHaveClass('mx-auto', 'w-full');
    expect(serverPanel().getByRole('tablist')).toHaveClass('border-b', 'px-4');
  });

  it('shows both panels, the server first and the desktop app second', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    const server = screen.getByLabelText('OpenLDR install command');
    const desktop = screen.getByLabelText('OpenLDR desktop install command');
    expect(server).toBeInTheDocument();
    expect(desktop).toBeInTheDocument();
    expect(server.compareDocumentPosition(desktop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Two ways to install. Each takes one line.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Server, with Docker' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Desktop app' })).toBeInTheDocument();
  });

  it('shows the desktop installer for Linux by default', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(desktopPanel().getByText(/desktop\.sh \| bash/)).toBeInTheDocument();
    expect(desktopPanel().getByText(/asks for the administrator password once/)).toBeInTheDocument();
    expect(desktopPanel().getByRole('link', { name: /desktop app guide/i })).toHaveAttribute('href', '/docs/desktop-app');
  });

  it('shows the desktop PowerShell command under its Windows tab', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    fireEvent.mouseDown(desktopPanel().getByRole('tab', { name: 'Windows' }), { button: 0, ctrlKey: false });
    expect(desktopPanel().getByText(/desktop\.ps1 \| iex/)).toBeInTheDocument();
    expect(desktopPanel().getByText(/Windows 10 or 11, 64-bit\. The app is not signed\./)).toBeInTheDocument();
  });

  it('shows the macOS note under the desktop macOS tab', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    fireEvent.mouseDown(desktopPanel().getByRole('tab', { name: 'macOS' }), { button: 0, ctrlKey: false });
    expect(desktopPanel().getByText(/desktop\.sh \| bash/)).toBeInTheDocument();
    expect(desktopPanel().getByText(/Apple silicon only\. The app is not signed\./)).toBeInTheDocument();
  });

  it('copies the desktop command from the desktop panel', async () => {
    const original = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      render(<InstallBlock />, { wrapper: MemoryRouter });
      fireEvent.click(desktopPanel().getByRole('button', { name: /copy/i }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('desktop.sh')));
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });

  it('lets each panel shrink inside the grid so a long command cannot widen the page', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByLabelText('OpenLDR install command')).toHaveClass('min-w-0');
    expect(screen.getByLabelText('OpenLDR desktop install command')).toHaveClass('min-w-0');
    expect(desktopPanel().getByText(/curl -fsSL/)).toHaveClass('min-w-0', 'overflow-x-auto', 'whitespace-nowrap');
  });
});
