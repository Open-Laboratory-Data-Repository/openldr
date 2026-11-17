import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWorkflowRun, fetchWorkflowRuns, type ExecuteResponse } from '@/api';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { rowsFromItems, type SampleRow } from './rows';

/** How often Listen asks for new runs, and when it gives up. */
export const LISTEN_POLL_MS = 2000;
export const LISTEN_MAX_MS = 60000;

export type ListenState = 'idle' | 'listening' | 'timedOut' | 'failed';

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
  const [listen, setListen] = useState<ListenState>('idle');
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

  const stopTimers = useCallback(() => {
    token.current += 1;
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.stop) clearTimeout(timers.current.stop);
    timers.current = {};
  }, []);

  const loadLastRun = () => {
    const raw = lastRunItems();
    setRows(raw === undefined ? [] : rowsFromItems(raw, sourcePath));
  };

  const stopListening = useCallback(() => {
    stopTimers();
    setListen('idle');
  }, [stopTimers]);

  const startListening = () => {
    if (!workflowId) return;
    stopTimers();
    const mine = token.current;
    const since = Date.now();
    const seen = new Set<string>();
    const feederIds = [...feeders];
    setListen('listening');

    const tick = async () => {
      try {
        const runs = await fetchWorkflowRuns(workflowId, { limit: 10 });
        for (const run of runs) {
          if (token.current !== mine) return;
          if (seen.has(run.id) || Date.parse(run.startedAt) < since) continue;
          seen.add(run.id);
          const detail = await fetchWorkflowRun(run.id);
          if (token.current !== mine) return;
          const results = (detail.result as ExecuteResponse | null)?.results ?? [];
          const feed = results.find((r) => feederIds.includes(r.nodeId) && r.output != null);
          if (feed) {
            stopTimers();
            setRows(rowsFromItems(feed.output, sourcePath));
            setListen('idle');
            return;
          }
        }
      } catch {
        if (token.current !== mine) return;
        stopTimers();
        setListen('failed');
      }
    };

    timers.current.poll = setInterval(() => void tick(), LISTEN_POLL_MS);
    timers.current.stop = setTimeout(() => {
      if (token.current !== mine) return;
      stopTimers();
      setListen('timedOut');
    }, LISTEN_MAX_MS);
  };

  // Closing the sheet stops Listen and forgets the samples.
  useEffect(() => {
    if (!open) {
      stopTimers();
      setListen('idle');
      setRows([]);
    }
  }, [open, stopTimers]);

  useEffect(() => stopTimers, [stopTimers]);

  return {
    rows,
    hasLastRun,
    canListen: workflowId != null,
    listen,
    loadLastRun,
    startListening,
    stopListening,
  };
}
