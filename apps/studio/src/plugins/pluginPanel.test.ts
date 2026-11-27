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
    // The fresh list also says who the plugin is: its name, its version, and no serial grant.
    expect(getPluginPanel()).toEqual({ id: 'notes', title: 'Lab notes', permissionKeys: [], label: 'notes', version: '1.0.0', serial: false });
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

  it('keeps who the plugin is, for the serial question and the grant', () => {
    openPluginPanel('analyzer', 'Ports', [], { label: 'Analyzer interface', version: '1.0.0', serial: true });
    expect(getPluginPanel()).toEqual({ id: 'analyzer', title: 'Ports', permissionKeys: [], label: 'Analyzer interface', version: '1.0.0', serial: true });
  });

  it('gives no serial port to a panel opened without the listing\'s facts', () => {
    openPluginPanel('notes', 'Notes');
    expect(getPluginPanel()?.serial).toBeUndefined();
  });

  it('takes a new version and a changed grant from a fresh list', () => {
    openPluginPanel('analyzer', 'Ports', [], { label: 'Analyzer interface', version: '1.0.0', serial: true });
    syncPluginPanel([{ ...entry('analyzer', { panel: { title: 'Ports' } }), version: '1.1.0', devices: { serial: false } }]);
    expect(getPluginPanel()).toMatchObject({ version: '1.1.0', serial: false });
    // An older server sends no devices: no grant.
    openPluginPanel('analyzer', 'Ports', [], { label: 'Analyzer interface', version: '1.0.0', serial: true });
    syncPluginPanel([entry('analyzer', { panel: { title: 'Ports' } })]);
    expect(getPluginPanel()?.serial).toBe(false);
  });
});
