import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
  close: vi.fn(),
  listSections: vi.fn(),
  addSection: vi.fn(),
  removeSection: vi.fn(),
  get: vi.fn(),
  setLabSettings: vi.fn(),
  allowSelfAuthorise: vi.fn(),
  setAllowSelfAuthorise: vi.fn(),
}));

vi.mock('@openldr/config', async () => {
  const actual = await vi.importActual<typeof import('@openldr/config')>('@openldr/config');
  return { ...actual, loadConfig: vi.fn(() => ({ config: true })) };
});
vi.mock('./cli-actor', () => ({ cliActor: () => ({ actorType: 'cli', actorId: null, actorName: 'tester' }), callerName: () => 'tester' }));
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    recordAuditEvent: mocks.recordAuditEvent,
    LabSectionError: actual.LabSectionError,
    TestCatalogError: actual.TestCatalogError,
  };
});

import { LabSectionError, TestCatalogError } from '@openldr/bootstrap';
import { COMMAND_META } from './command-meta';
import {
  runLabSectionsAdd, runLabSectionsList, runLabSectionsRemove, runLabSettingsSet, runLabTestsSet,
} from './lab';

const ACTOR = { actorType: 'cli', actorId: null, actorName: 'tester' };
const LAB = { enabled: true, specimenTypes: null, localDisplay: null, section: null, needsReview: true };

describe('openldr lab', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({
      labSections: { listSections: mocks.listSections, addSection: mocks.addSection, removeSection: mocks.removeSection },
      testCatalog: { get: mocks.get, setLabSettings: mocks.setLabSettings },
      labIdentity: { allowSelfAuthorise: mocks.allowSelfAuthorise, setAllowSelfAuthorise: mocks.setAllowSelfAuthorise },
      close: mocks.close,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  describe('sections list', () => {
    it('prints one section per line, or says there are none', async () => {
      mocks.listSections.mockResolvedValue([{ code: 'haem', name: 'Haematology' }, { code: 'micro', name: 'Microbiology' }]);
      expect(await runLabSectionsList({ json: false })).toBe(0);
      expect(out.join('')).toBe('haem\tHaematology\nmicro\tMicrobiology\n');
      out.length = 0;
      mocks.listSections.mockResolvedValue([]);
      expect(await runLabSectionsList({ json: false })).toBe(0);
      expect(out.join('')).toBe('(no sections)\n');
      expect(mocks.close).toHaveBeenCalledTimes(2);
    });

    it('prints JSON with --json', async () => {
      mocks.listSections.mockResolvedValue([{ code: 'haem', name: 'Haematology' }]);
      await runLabSectionsList({ json: true });
      expect(JSON.parse(out.join(''))).toEqual([{ code: 'haem', name: 'Haematology' }]);
    });
  });

  describe('sections add', () => {
    it('adds through the shared service and audits as the CLI, with the route action', async () => {
      mocks.addSection.mockResolvedValue({ code: 'haem', name: 'Haematology' });
      expect(await runLabSectionsAdd('haem', 'Haematology', { json: false })).toBe(0);
      expect(mocks.addSection).toHaveBeenCalledWith('haem', 'Haematology');
      expect(out.join('')).toBe('Added section haem (Haematology).\n');
      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), ACTOR, {
        action: 'settings.lab.section.add', entityType: 'lab_section', entityId: 'haem',
        after: { code: 'haem', name: 'Haematology' },
      });
    });

    it('reports a refusal in the service words and audits nothing', async () => {
      mocks.addSection.mockRejectedValue(new LabSectionError('section haem already exists', 'conflict'));
      expect(await runLabSectionsAdd('haem', 'Haematology', { json: false })).toBe(1);
      expect(err.join('')).toBe('lab sections add failed: section haem already exists\n');
      expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
      expect(mocks.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('sections remove', () => {
    it('refuses without --force and opens nothing', async () => {
      expect(await runLabSectionsRemove('haem', { force: false, json: false })).toBe(1);
      expect(err.join('')).toBe('Refusing to remove section haem without --force.\n');
      expect(mocks.createAppContext).not.toHaveBeenCalled();
      expect(mocks.removeSection).not.toHaveBeenCalled();
    });

    it('removes with --force and audits the section it removed', async () => {
      mocks.listSections.mockResolvedValue([{ code: 'haem', name: 'Haematology' }]);
      mocks.removeSection.mockResolvedValue(undefined);
      expect(await runLabSectionsRemove('haem', { force: true, json: false })).toBe(0);
      expect(mocks.removeSection).toHaveBeenCalledWith('haem');
      expect(out.join('')).toBe('Removed section haem.\n');
      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), ACTOR, {
        action: 'settings.lab.section.remove', entityType: 'lab_section', entityId: 'haem',
        before: { code: 'haem', name: 'Haematology' },
      });
    });

    it('reports a section a test still uses in the service words', async () => {
      mocks.listSections.mockResolvedValue([{ code: 'haem', name: 'Haematology' }]);
      mocks.removeSection.mockRejectedValue(new LabSectionError('section haem is used by 2 tests', 'conflict'));
      expect(await runLabSectionsRemove('haem', { force: true, json: false })).toBe(1);
      expect(err.join('')).toBe('lab sections remove failed: section haem is used by 2 tests\n');
      expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('tests set', () => {
    it('sets the section and review through setLabSettings, and audits as the route does', async () => {
      mocks.get.mockResolvedValue({ code: 'HIVVL', lab: LAB });
      mocks.setLabSettings.mockResolvedValue({ code: 'HIVVL', lab: { ...LAB, section: 'haem', needsReview: false } });
      expect(await runLabTestsSet('HIVVL', { section: 'haem', needsReview: 'false', json: false })).toBe(0);
      expect(mocks.setLabSettings).toHaveBeenCalledWith('HIVVL', { section: 'haem', needsReview: false });
      expect(out.join('')).toBe('HIVVL: section haem, needs review no.\n');
      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), ACTOR, {
        action: 'test_catalog.lab_settings', entityType: 'test_catalog', entityId: 'HIVVL',
        before: LAB, after: { ...LAB, section: 'haem', needsReview: false },
      });
    });

    it('clears the section with --no-section and leaves review alone', async () => {
      mocks.get.mockResolvedValue({ code: 'HIVVL', lab: { ...LAB, section: 'haem' } });
      mocks.setLabSettings.mockResolvedValue({ code: 'HIVVL', lab: LAB });
      expect(await runLabTestsSet('HIVVL', { section: false, json: false })).toBe(0);
      expect(mocks.setLabSettings).toHaveBeenCalledWith('HIVVL', { section: null });
      expect(out.join('')).toBe('HIVVL: no section, needs review yes.\n');
    });

    it('refuses a --needs-review that is not true or false, and nothing to set, before opening anything', async () => {
      expect(await runLabTestsSet('HIVVL', { needsReview: 'yes', json: false })).toBe(1);
      expect(err.join('')).toBe('lab tests set failed: --needs-review must be true or false\n');
      err.length = 0;
      expect(await runLabTestsSet('HIVVL', { json: false })).toBe(1);
      expect(err.join('')).toBe('lab tests set failed: pass --section <code>, --no-section or --needs-review true|false\n');
      expect(mocks.createAppContext).not.toHaveBeenCalled();
    });

    it('reports an unknown section in the service words', async () => {
      mocks.get.mockResolvedValue({ code: 'HIVVL', lab: LAB });
      mocks.setLabSettings.mockRejectedValue(new TestCatalogError('no section blood', 'invalid'));
      expect(await runLabTestsSet('HIVVL', { section: 'blood', json: false })).toBe(1);
      expect(err.join('')).toBe('lab tests set failed: no section blood\n');
      expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('settings set', () => {
    it('sets allow-self-authorise and audits as the route does', async () => {
      mocks.allowSelfAuthorise.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      expect(await runLabSettingsSet('allow-self-authorise', 'true', { json: false })).toBe(0);
      expect(mocks.setAllowSelfAuthorise).toHaveBeenCalledWith(true, 'tester');
      expect(out.join('')).toBe('allow-self-authorise is now true.\n');
      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), ACTOR, {
        action: 'settings.lab.allow_self_authorise', entityType: 'settings', entityId: 'lab.allowSelfAuthorise',
        before: { value: false }, after: { value: true },
      });
    });

    it('refuses an unknown setting or a value that is not true or false, before opening anything', async () => {
      expect(await runLabSettingsSet('self-authorise', 'true', { json: false })).toBe(1);
      expect(err.join('')).toBe('lab settings set failed: unknown setting self-authorise (known: allow-self-authorise)\n');
      err.length = 0;
      expect(await runLabSettingsSet('allow-self-authorise', 'yes', { json: false })).toBe(1);
      expect(err.join('')).toBe('lab settings set failed: allow-self-authorise must be true or false\n');
      expect(mocks.createAppContext).not.toHaveBeenCalled();
    });
  });

  // Served mode: the server refuses an app command when the account lacks this key
  // (command-meta.ts), so each lab command needs lab.settings to run through the app.
  it('every lab command needs lab.settings in served mode, and remove is destructive', () => {
    const paths = Object.keys(COMMAND_META).filter((p) => p.startsWith('lab ')).sort();
    expect(paths).toEqual(['lab sections add', 'lab sections list', 'lab sections remove', 'lab settings set', 'lab tests set']);
    for (const p of paths) {
      expect(COMMAND_META[p]?.kind, p).toBe('app');
      expect(COMMAND_META[p]?.capability, p).toBe('lab.settings');
    }
    expect(COMMAND_META['lab sections remove']?.destructive).toBe(true);
  });
});
