import { beforeEach, describe, expect, it, vi } from 'vitest';

const installSpy = vi.hoisted(() => vi.fn(async () => 0));
const updateSpy = vi.hoisted(() => vi.fn(async () => 0));

vi.mock('./market', async () => {
  const actual = await vi.importActual<typeof import('./market')>('./market');
  return { ...actual, runMarketInstall: installSpy, runMarketUpdate: updateSpy };
});

import { buildProgram } from './program';

describe('market install and update flags', () => {
  beforeEach(() => {
    installSpy.mockClear();
    updateSpy.mockClear();
    process.exitCode = undefined;
  });

  it('update --force passes force to the update command, not install', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'market', 'update', '/some/dir', '--force']);
    expect(updateSpy).toHaveBeenCalledWith('/some/dir', expect.objectContaining({ force: true, dryRun: false }));
    expect(installSpy).not.toHaveBeenCalled();
  });

  it('update --dry-run passes dryRun to the update command', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'market', 'update', '/some/dir', '--dry-run']);
    expect(updateSpy).toHaveBeenCalledWith('/some/dir', expect.objectContaining({ dryRun: true }));
  });

  it('install --force passes force to the installer', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'market', 'install', '/some/dir', '--force']);
    expect(installSpy).toHaveBeenCalledWith('/some/dir', expect.objectContaining({ force: true }));
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
