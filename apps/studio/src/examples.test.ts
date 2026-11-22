import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardSchema, sqlAuthoringRefusal } from '@openldr/dashboards';
import { WorkflowSchema } from '@openldr/workflows/types';
import { FormCreateInputSchema } from '@openldr/forms/pure';
import { importDashboard } from './dashboard/io';
import { workflowCreateFromImport } from './workflows/workflow-import';
import { formCreateFromImport } from './pages/form-import';

/**
 * Every file in `examples/dashboards`, `examples/workflows` and `examples/forms` goes through the
 * reshaping studio runs on import, then the schema the server checks. Bootstrap's own examples test
 * covers the other folders and `workflows/payload.json`.
 */

// Studio's tests run in jsdom, where import.meta.url is not a file URL, so the path comes from __dirname.
const EXAMPLES = `${resolve(__dirname, '../../../examples')}/`;

// The files this test checks in each folder it owns.
const CHECKED: Record<string, string[]> = {
  dashboards: ['lab-overview.dashboard.json', 'one-widget.dashboard.json'],
  workflows: ['ingest-lab-rows.workflow.json', 'send.sh'],
  forms: ['lab-order.form.json'],
};

// Files in those folders that bootstrap's examples test checks instead.
const CHECKED_ELSEWHERE: Record<string, string[]> = {
  workflows: ['payload.json'],
};

const read = (path: string): string => readFileSync(`${EXAMPLES}${path}`, 'utf8');
const readJson = (path: string): unknown => JSON.parse(read(path));

describe('the examples studio checks', () => {
  it('each folder this test owns has a README', () => {
    for (const folder of Object.keys(CHECKED)) {
      expect(() => statSync(`${EXAMPLES}${folder}/README.md`), `${folder}/README.md`).not.toThrow();
    }
  });

  it('every file in dashboards, workflows and forms is checked', () => {
    for (const [folder, files] of Object.entries(CHECKED)) {
      const present = readdirSync(`${EXAMPLES}${folder}`).filter((n) => n !== 'README.md').sort();
      expect(present, folder).toEqual([...files, ...(CHECKED_ELSEWHERE[folder] ?? [])].sort());
    }
  });
});

describe('dashboards', () => {
  it('each dashboard passes DashboardSchema after studio\'s import', () => {
    for (const file of CHECKED.dashboards) {
      const dashboard = importDashboard(readJson(`dashboards/${file}`), []);
      const parsed = DashboardSchema.parse(dashboard);
      expect(parsed.widgets.length, file).toBeGreaterThanOrEqual(1);
      expect(parsed.layout.map((l) => l.i).sort(), file).toEqual(parsed.widgets.map((w) => w.id).sort());
    }
  });

  it('each dashboard saves on a default install, where raw SQL is off', () => {
    for (const file of CHECKED.dashboards) {
      const parsed = DashboardSchema.parse(importDashboard(readJson(`dashboards/${file}`), []));
      expect(sqlAuthoringRefusal(parsed, false, new Set()), file).toBeNull();
    }
  });
});

describe('workflows', () => {
  type Node = { type: string; data: { action?: string; path?: string; secret?: string; config?: { secret?: string; formIds?: unknown; targetId?: unknown } } };

  it('the workflow passes WorkflowSchema after studio\'s import, switched off, with no secret', () => {
    const input = workflowCreateFromImport(readJson('workflows/ingest-lab-rows.workflow.json'), 'wf_example');
    expect(input).not.toBeNull();
    const wf = WorkflowSchema.parse(input);
    expect(wf.enabled).toBe(false);

    const nodes = wf.definition.nodes as unknown as Node[];
    const webhook = nodes.find((n) => n.type === 'webhook');
    expect(webhook).toBeDefined();
    expect(webhook!.data.secret ?? '').toBe('');
    expect(webhook!.data.config?.secret ?? '').toBe('');
    expect(webhook!.data.path).not.toBe('ingest');

    const map = nodes.find((n) => n.data.action === 'map-to-fhir');
    expect(map?.data.config?.formIds).toEqual([]);
    expect(map?.data.config?.targetId).toBe('lab-result');
  });

  it('send.sh takes the secret from the environment only', () => {
    const script = read('workflows/send.sh');
    expect(script).toContain('$OPENLDR_WEBHOOK_SECRET');
    const tokenLines = script.split('\n').filter((l) => /X-Webhook-Token/i.test(l));
    expect(tokenLines.length).toBeGreaterThanOrEqual(1);
    for (const line of tokenLines) {
      const value = line.match(/X-Webhook-Token:\s*([^"']*)/i)?.[1]?.trim();
      expect(value, line).toBe('$OPENLDR_WEBHOOK_SECRET');
    }
    const path = (webhookPath()).replace(/^\/+/, '');
    expect(script).toContain(`$OPENLDR_URL/api/workflows/hooks/${path}`);
  });

  const webhookPath = (): string => {
    const wf = readJson('workflows/ingest-lab-rows.workflow.json') as { definition: { nodes: Node[] } };
    return wf.definition.nodes.find((n) => n.type === 'webhook')!.data.path!;
  };
});

describe('forms', () => {
  it('the form passes the server\'s form input schema after studio\'s import', () => {
    const input = formCreateFromImport(readJson('forms/lab-order.form.json'));
    expect(input).not.toBeNull();
    const parsed = FormCreateInputSchema.parse(input);
    expect(parsed.schema.fields.length).toBeGreaterThanOrEqual(1);
  });
});
