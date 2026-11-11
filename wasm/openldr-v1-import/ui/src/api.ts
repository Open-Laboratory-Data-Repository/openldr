import { getOpenldr } from './sdk';

// Shapes the host returns for the import ops (packages/bootstrap/src/import-run.ts and
// plugin-broker.ts). The SDK types them as unknown, so they are pinned here.
export interface AllowedConnector { id: string; name: string; type: string | null }
export type StepStatus = 'pass' | 'warn' | 'fail' | 'skip';
export interface DiagnoseStep { id: string; status: StepStatus; detail?: string }
export interface DiagnoseResult { ok: boolean; steps: DiagnoseStep[] }
export interface CheckResult { id: string; value: unknown; error?: string }
export type RunStatus = 'running' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'interrupted';
export interface ImportRun {
  id: string;
  connectorId: string;
  status: RunStatus;
  dryRun: boolean;
  options: Record<string, string>;
  limit: number | null;
  counts: { keys: number; imported: number; failed: number; resources: number };
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
}
export interface Failure { key: string; error: string }

const imports = () => getOpenldr().imports;

export const api = {
  allowed: () => imports().allowed() as Promise<AllowedConnector[]>,
  diagnose: (connectorId: string) => imports().diagnose(connectorId) as Promise<DiagnoseResult>,
  checks: (connectorId: string, options: Record<string, string>) => imports().checks({ connectorId, options }) as Promise<CheckResult[]>,
  start: (input: { connectorId: string; options: Record<string, string>; limit?: number; dryRun?: boolean }) => imports().start(input) as Promise<ImportRun>,
  status: (runId: string) => imports().status(runId) as Promise<ImportRun | null>,
  list: () => imports().list() as Promise<ImportRun[]>,
  failures: (runId: string) => imports().failures(runId) as Promise<Failure[]>,
  stop: (runId: string) => imports().stop(runId) as Promise<ImportRun>,
  resume: (runId: string) => imports().resume(runId) as Promise<ImportRun>,
};

export const isActive = (status: RunStatus): boolean => status === 'running' || status === 'stopping';
export const canResume = (status: RunStatus): boolean => status === 'stopped' || status === 'failed' || status === 'interrupted';
