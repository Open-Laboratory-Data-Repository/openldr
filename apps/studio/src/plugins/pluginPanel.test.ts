import { describe, it, expect, beforeEach } from 'vitest';
import type { PluginUiEntry } from '@/api';
import { getPluginPanel, openPluginPanel, closePluginPanel, syncPluginPanel } from './pluginPanel';

const entry = (id: string, sites: PluginUiEntry['sites']): PluginUiEntry => ({
  id, version: '1.0.0', nav: { label: id, icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1',
  hasWebview: true, hasDeclarative: false, declarative: null, sites,
});

describe('plugin panel store', () => {
  beforeEach(() => closePluginPanel());

  it('opens and closes', () => {
    expect(getPluginPanel()).toBeNull();
    openPluginPanel('notes', 'Notes');
    expect(getPluginPanel()).toEqual({ id: 'notes', title: 'Notes', permissionKeys: [] });
    closePluginPanel();
    expect(getPluginPanel()).toBeNull();
  });
  it("keeps the plugin's own permission keys for the panel's page", () => {
    openPluginPanel('lab', 'Lab', ['lab.receive']);
    expect(getPluginPanel()).toEqual({ id: 'lab', title: 'Lab', permissionKeys: ['lab.receive'] });
  });

  it('sync keeps the panel while its plugin still offers one, and takes the new title', () => {
    openPluginPanel('notes', 'Notes');
    syncPluginPanel([entry('notes', { panel: { title: 'Lab notes' } })]);
    expect(getPluginPanel()).toEqual({ id: 'notes', title: 'Lab notes', permissionKeys: [] });
  });

  it('sync closes the panel when the plugin is gone (disabled, removed, or role lost)', () => {
    openPluginPanel('notes', 'Notes');
    syncPluginPanel([entry('other', { panel: { title: 'Other' } })]);
    expect(getPluginPanel()).toBeNull();
  });

  it('sync closes the panel when an admin switched the panel off', () => {
    openPluginPanel('notes', 'Notes');
    syncPluginPanel([entry('notes', { widget: { title: 'W', height: 'small' } })]);
    expect(getPluginPanel()).toBeNull();
  });
});
