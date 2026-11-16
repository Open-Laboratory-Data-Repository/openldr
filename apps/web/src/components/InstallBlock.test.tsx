import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InstallBlock } from './InstallBlock';

const comparison = () => within(screen.getByRole('table', { name: 'Compare OpenLDR installation options' }));

describe('InstallBlock', () => {
  it('keeps the install destination and presents three free deployment options', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: 'OpenLDR installation' })).toHaveAttribute('id', 'install');
    for (const name of ['Standalone', 'Server', 'Enterprise']) {
      expect(comparison().getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(comparison().getAllByText('Free')).toHaveLength(3);
    for (const name of ['Custom dashboards', 'Custom workflows', 'Plugins', 'Terminology services', 'Reports']) {
      const row = comparison().getByRole('row', { name: `${name} Yes Yes Yes` });
      expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Yes', 'Yes', 'Yes']);
    }
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('distinguishes container requirements and marks enterprise capabilities as planned', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    const containers = comparison().getByRole('row', { name: 'Docker containers Not required Required Planned' });
    expect(within(containers).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Not required', 'Required', 'Planned']);
    const backups = comparison().getByRole('row', { name: /Backups/ });
    expect(backups).toHaveTextContent('Folder-based');
    expect(backups).toHaveTextContent('Operator-managed backups');
    expect(backups).toHaveTextContent('Redundant backups, planned');
    expect(comparison().getByRole('row', { name: 'Load balancing No Manual setup supported Planned' })).toBeInTheDocument();
    expect(comparison().getByText('In development / testing')).toBeInTheDocument();
    expect(screen.getByText(/There is no Enterprise installer yet/)).toBeInTheDocument();
  });

  it('takes readers to the appropriate guides instead of running an installer', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(comparison().getByRole('link', { name: 'Install standalone' })).toHaveAttribute('href', '/docs/desktop-app');
    expect(comparison().getByRole('link', { name: 'Install server' })).toHaveAttribute('href', '/docs/install');
    expect(comparison().getByRole('link', { name: 'Read development status' })).toHaveAttribute('href', '/docs/getting-started');
    expect(screen.queryByRole('link', { name: 'Install enterprise' })).toBeNull();
  });

  it('gives each phone card its own feature labels, availability and guide', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    const standalone = within(screen.getByRole('article', { name: 'Standalone installation' }));
    const server = within(screen.getByRole('article', { name: 'Server installation' }));
    const enterprise = within(screen.getByRole('article', { name: 'Enterprise installation' }));
    for (const card of [standalone, server, enterprise]) {
      expect(card.getByRole('heading', { name: 'Application features' })).toBeInTheDocument();
      expect(card.getByRole('heading', { name: 'Deployment' })).toBeInTheDocument();
      for (const name of ['Custom dashboards', 'Custom workflows', 'Plugins', 'Terminology services', 'Reports']) {
        expect(card.getByText(name)).toBeInTheDocument();
      }
      expect(card.getAllByText('Yes')).toHaveLength(5);
    }
    expect(standalone.getByText('Docker containers')).toBeInTheDocument();
    expect(standalone.getByText('Bundled PostgreSQL')).toBeInTheDocument();
    expect(standalone.getByRole('link', { name: 'Install standalone' })).toHaveAttribute('href', '/docs/desktop-app');
    expect(server.getByText('S3-compatible storage')).toBeInTheDocument();
    expect(server.getByText('Manual setup supported')).toBeInTheDocument();
    expect(server.getByRole('link', { name: 'Install server' })).toHaveAttribute('href', '/docs/install');
    expect(enterprise.getByText('In development / testing')).toBeInTheDocument();
    expect(enterprise.getByText('Redundant backups, planned')).toBeInTheDocument();
    expect(enterprise.getByRole('link', { name: 'Read development status' })).toHaveAttribute('href', '/docs/getting-started');
  });
});
