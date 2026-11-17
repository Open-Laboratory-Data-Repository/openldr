import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWorkflowRun, fetchWorkflowRuns, type ExecuteResponse, type WorkflowRunSummary } from '@/api';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { rowsFromItems, type SampleRow } from './rows';

/** How often Listen asks for new runs, and when it gives up. */
export const LISTEN_POLL_MS = 2000;
export const LISTEN_MAX_MS = 60000;
/** How many of the newest stored runs are read, by Listen and by "Use the latest stored run". */
export const STORED_RUNS_LOOKED_AT = 10;

export type SampleStatus = 'idle' | 'listening' | 'loadingStored' | 'timedOut' | 'noStoredRun' | 'failed';

const newestFirst = (runs: WorkflowRunSummary[]) => [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

/**
 * The sheet's samples. They live in this hook's React state only: never in the workflow store's
 * definition, browser storage, a log or a toast. Closing the sheet forgets them.
 */
export function useSamples({ nodeId, open, sourcePath }: { nodeId: string; open: boolean; sourcePath: string }) {
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const edges = useWorkflowStore((s) => s.edges);
  const ownInput = useWorkflowStore((s) => s.nodeRunInput[nodeId]);
  const runOutputs = useWorkflowStore((s) => s.nodeRunOutput);

  const [rows, setRows] = useState<SampleRow[]>([]);
  const [status, setStatus] = useState<SampleStatus>('idle');
  const timers = useRef<{ poll?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout> }>({});
  const token = useRef(0);

  const feeders = edges.filter((e) => e.target === nodeId).map((e) => e.source);

  /** What the editor holds for the last run: this node's input, else its feeding node's output. */
  const lastRunItems = (): unknown => {
    if (Array.isArray(ownInput) ? ownInput.length > 0 : ownInput != null) return ownInput;
    for (const id of feeders) if (runOutputs[id] != null) return runOutputs[id];
    return undefined;
  };
  const hasLastRun = lastRunItems() !== undefined;

  /** The rows of one stored run: the feeding node's output, read through `sourcePath`. */
  const rowsOfRun = async (runId: string, feederIds: string[]): Promise<SampleRow[]> => {
    const detail = await fetchWorkflowRun(runId);
    const results = (detail.result as ExecuteResponse | null)?.results ?? [];
    for (const r of results) {
      if (!feederIds.includes(r.nodeId) || r.output == null) continue;
      const found = rowsFromItems(r.output, sourcePath);
      if (found.length > 0) return found;
    }
    return [];
  };

  const stopTimers = useCallback(() => {
    token.current += 1;
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.stop) clearTimeout(timers.current.stop);
    timers.current = {};
  }, []);

  const loadLastRun = () => {
    stopTimers();
    setStatus('idle');
    const raw = lastRunItems();
    setRows(raw === undefined ? [] : rowsFromItems(raw, sourcePath));
  };

  const stopListening = useCallback(() => {
    stopTimers();
    setStatus('idle');
  }, [stopTimers]);

  /** The newest of the last stored runs whose feeding node gave rows, with no waiting. */
  const loadLatestStoredRun = async () => {
    if (!workflowId) return;
    stopTimers();
    const mine = token.current;
    const feederIds = [...feeders];
    setStatus('loadingStored');
    try {
      const runs = newestFirst(await fetchWorkflowRuns(workflowId, { limit: STORED_RUNS_LOOKED_AT })).slice(0, STORED_RUNS_LOOKED_AT);
      for (const run of runs) {
        const found = await rowsOfRun(run.id, feederIds);
        if (token.current !== mine) return;
        if (found.length > 0) {
          setRows(found);
          setStatus('idle');
          return;
        }
      }
      if (token.current === mine) setStatus('noStoredRun');
    } catch {
      if (token.current === mine) setStatus('failed');
    }
  };

  /**
   * Poll for runs that were not there at the press, and stop at the first whose feeding node gave
   * rows. The runs seen at the press are the baseline, so the browser's clock plays no part.
   */
  const startListening = () => {
    if (!workflowId) return;
    stopTimers();
    const mine = token.current;
    const seen = new Set<string>();
    let ready = false;
    const feederIds = [...feeders];
    setStatus('listening');

    const tick = async () => {
      if (!ready) return;
      try {
        const runs = newestFirst(await fetchWorkflowRuns(workflowId, { limit: STORED_RUNS_LOOKED_AT }));
        for (const run of runs) {
          if (token.current !== mine) return;
          if (seen.has(run.id)) continue;
          seen.add(run.id);
          const found = await rowsOfRun(run.id, feederIds);
          if (token.current !== mine) return;
          if (found.length > 0) {
            stopTimers();
            setRows(found);
            setStatus('idle');
            return;
          }
        }
      } catch {
        if (token.current !== mine) return;
        stopTimers();
        setStatus('failed');
      }
    };

    fetchWorkflowRuns(workflowId, { limit: STORED_RUNS_LOOKED_AT })
      .then((runs) => {
        if (token.current !== mine) return;
        for (const r of runs) seen.add(r.id);
        ready = true;
      })
      .catch(() => {
        if (token.current !== mine) return;
        stopTimers();
        setStatus('failed');
      });
    timers.current.poll = setInterval(() => void tick(), LISTEN_POLL_MS);
    timers.current.stop = setTimeout(() => {
      if (token.current !== mine) return;
      stopTimers();
      setStatus('timedOut');
    }, LISTEN_MAX_MS);
  };

  // Closing the sheet stops Listen and forgets the samples.
  useEffect(() => {
    if (!open) {
      stopTimers();
      setStatus('idle');
      setRows([]);
    }
  }, [open, stopTimers]);

  useEffect(() => stopTimers, [stopTimers]);

  return {
    rows,
    hasLastRun,
    canListen: workflowId != null,
    status,
    loadLastRun,
    loadLatestStoredRun,
    startListening,
    stopListening,
  };
}
