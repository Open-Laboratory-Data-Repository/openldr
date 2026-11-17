/**
 * Streaming workflow executor.
 *
 * Each node has a handler in `node-handlers/`. The runner walks the graph in
 * topological order, passing the upstream node's output into the next handler
 * via an `ExecutionContext`. Per-node lifecycle events (`node:start`,
 * `node:log`, `node:success`, `node:error`, `workflow:done`) are emitted
 * through `ctx.emit` so an SSE endpoint can stream them to the UI; the same
 * runner is also used by the legacy `/execute` route, which buffers events
 * into a single `WorkflowRunResult`.
 */

import { pickHandler, type RunnerNode } from './node-handlers';
import { createContext, type CodeLimits, type ExecutionContext } from './execution-context';
import type { RunEvent, LogEntry, WorkflowEdge } from '../types';
import type { WorkflowServices } from './services';
import type { WorkflowItem } from './items';
import { computeLoopBody, planIterations, buildIterationNodes, type LoopBody } from './loop';
import { extractTerminalItems } from './sub-workflow';

export type WorkflowNode = RunnerNode;

export interface NodeRunResult {
  nodeId: string;
  type: string;
  label?: string;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  /** Structured result metadata (e.g. a plugin sink's import summary). Undefined for most nodes. */
  meta?: unknown;
  error?: string;
  durationMs: number;
  logs?: LogEntry[];
}

export interface WorkflowRunResult {
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  results: NodeRunResult[];
}

/** Topological sort. Same algorithm as before, just keyed off the new types. */
export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/**
 * Feed each node the concatenation of all ran, non-skipped upstream edges' item
 * arrays. Single-input → that node's items; multi-input → concatenation (Merge
 * relies on this). Sources with no upstream get [].
 */
function upstreamItemsFor(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  nodeOutputs: Record<string, WorkflowItem[]>,
  skippedEdges: Set<string>,
  portItems: Record<string, Record<string, WorkflowItem[]>> = {},
): WorkflowItem[] {
  const out: WorkflowItem[] = [];
  for (const edge of edges) {
    if (edge.target !== node.id) continue;
    if (skippedEdges.has(edge.id)) continue;
    const ports = portItems[edge.source];
    const items = ports ? ports[edge.sourceHandle || 'out'] : nodeOutputs[edge.source];
    if (Array.isArray(items)) out.push(...items);
  }
  return out;
}

export interface RunWorkflowOptions {
  /** Initial trigger payload, e.g. webhook body. */
  input?: unknown;
  /** Per-event sink. Defaults to a no-op so the legacy /execute path stays untouched. */
  onEvent?: (evt: RunEvent) => void;
  /** Limits + enable flag for the Code node sandbox. When undefined, createContext's default (disabled) applies. */
  codeLimits?: CodeLimits;
  /** Server-provided data capabilities for source nodes. */
  services?: WorkflowServices;
  /** ID of the persisted workflow record — forwarded to the execution context. */
  workflowId?: string;
  /** Per-run file attachments seeded onto the trigger item. */
  files?: Record<string, import('./items').BinaryRef>;
  /** Workflow-id recursion chain forwarded to the execution context (execute-workflow guard). Defaults to []. */
  callStack?: string[];
  /** Seed the loop iteration stack (nested-loop recursion forwards this). */
  loopVars?: Array<{ index: number; item?: Record<string, unknown> }>;
  /** Override the loop accumulation cap (from cfg.WORKFLOW_LOOP_MAX_ITEMS). */
  loopMaxItems?: number;
}

export async function runWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  opts: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const startedAt = new Date().toISOString();
  const ctx = createContext(opts.input, opts.onEvent ?? (() => {}), edges, opts.codeLimits, opts.services, opts.workflowId, opts.files, opts.callStack ?? []);
  if (opts.loopVars) ctx.loopVars = opts.loopVars;
  if (opts.loopMaxItems != null) ctx.loopMaxItems = opts.loopMaxItems;
  const sorted = topologicalSort(nodes, edges);

  // Loop pre-pass: compute each loop node's body region and exclude body nodes
  // from the main pass. A malformed loop defers its error to when the loop node runs.
  const loopInfo = new Map<string, LoopBody | { error: string }>();
  const excludedBody = new Set<string>();
  for (const n of nodes) {
    if (n.type !== 'loop') continue;
    try {
      const info = computeLoopBody(n.id, nodes, edges);
      loopInfo.set(n.id, info);
      for (const id of info.bodyNodeIds) excludedBody.add(id);
    } catch (err) {
      loopInfo.set(n.id, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const results: NodeRunResult[] = [];

  // Track edges we should ignore because their source's `branch` output
  // says we went the other way (e.g. a condition that took the `true` branch
  // shouldn't run any node connected to its `false` handle).
  const skippedEdges = new Set<string>();
  const skippedNodes = new Set<string>();

  let failed = false;

  for (const node of sorted) {
    if (excludedBody.has(node.id)) continue;

    // If every incoming edge to this node was skipped, skip the node too.
    const incoming = edges.filter((e) => e.target === node.id);
    if (incoming.length > 0 && incoming.every((e) => skippedEdges.has(e.id))) {
      skippedNodes.add(node.id);
      results.push({
        nodeId: node.id,
        type: node.type,
        label: node.data.label as string | undefined,
        status: 'skipped',
        durationMs: 0,
      });
      // Cascade: also skip outgoing edges so anything purely downstream of
      // a skipped node won't fire either.
      for (const e of edges.filter((edge) => edge.source === node.id)) {
        skippedEdges.add(e.id);
      }
      continue;
    }

    ctx.emit({ type: 'node:start', nodeId: node.id, nodeType: node.type });

    const start = Date.now();
    try {
      const input = upstreamItemsFor(node, edges, ctx.nodeOutputs, skippedEdges, ctx.portItems);
      let output: WorkflowItem[];
      if (node.type === 'loop') {
        output = await executeLoopNode(node, ctx, input, nodes, loopInfo.get(node.id)!);
        ctx.nodeOutputs[node.id] = output;
        ctx.branches[node.id] = 'done'; // prune the loop-handle edges in the main pass
      } else {
        const handler = pickHandler(node);
        output = await handler(node, ctx, input);
        ctx.nodeOutputs[node.id] = output;
      }

      const durationMs = Date.now() - start;
      const meta = ctx.nodeMeta[node.id];
      results.push({
        nodeId: node.id,
        type: node.type,
        label: node.data.label as string | undefined,
        status: 'success',
        output,
        meta,
        durationMs,
        logs: ctx.logs[node.id],
      });
      ctx.emit({
        type: 'node:success',
        nodeId: node.id,
        nodeType: node.type,
        input,
        output,
        meta,
        durationMs,
      });

      // Branch pruning: If/Filter record their chosen handle in ctx.branches.
      const branch = ctx.branches[node.id];
      if (branch !== undefined) {
        for (const e of edges.filter((edge) => edge.source === node.id)) {
          if (e.sourceHandle && e.sourceHandle !== branch) skippedEdges.add(e.id);
        }
      }

      // Port pruning: a node that set portItems skips each edge whose port has no items.
      const ports = ctx.portItems[node.id];
      if (ports) {
        for (const e of edges.filter((edge) => edge.source === node.id)) {
          if ((ports[e.sourceHandle || 'out'] ?? []).length === 0) skippedEdges.add(e.id);
        }
      }
    } catch (err) {
      failed = true;
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        nodeId: node.id,
        type: node.type,
        label: node.data.label as string | undefined,
        status: 'error',
        error: message,
        // A node may record its meta before it throws (Map to FHIR's held counts and reasons).
        ...(ctx.nodeMeta[node.id] !== undefined ? { meta: ctx.nodeMeta[node.id] } : {}),
        durationMs,
        logs: ctx.logs[node.id],
      });
      ctx.emit({
        type: 'node:error',
        nodeId: node.id,
        nodeType: node.type,
        error: message,
        durationMs,
      });
      // Stop on first failure (matches typical workflow tools).
      break;
    }
  }

  const status: 'completed' | 'failed' = failed ? 'failed' : 'completed';
  ctx.emit({ type: 'workflow:done', status });

  return {
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
}

/** What a run's data came to, where a step reported it. Absent means no step said. */
export interface OutcomeCounts {
  mapped?: number;
  held?: number;
  persisted?: number;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Mapped and held rows from Map to FHIR steps (their meta has `heldReasons`), persisted records
 * from Persist store steps (their meta has `batchId`), and a loop step's own `bodyCounts`.
 * Results carry no step kind, so the meta's shape tells them apart. The studio's run history
 * reads the same shapes (`run-history-drawer.tsx`, `runCounts`).
 */
export function outcomeCounts(results: { meta?: unknown }[], into: OutcomeCounts = {}): OutcomeCounts {
  const add = (k: keyof OutcomeCounts, n: unknown) => {
    if (isCount(n)) into[k] = (into[k] ?? 0) + n;
  };
  for (const r of results) {
    const meta = r.meta as Record<string, unknown> | null | undefined;
    if (!meta || typeof meta !== 'object') continue;
    if (Array.isArray(meta.heldReasons)) {
      add('mapped', meta.mapped);
      add('held', meta.held);
    }
    if (typeof meta.batchId === 'string') add('persisted', meta.persisted);
    const body = meta.bodyCounts as OutcomeCounts | undefined;
    if (body && typeof body === 'object') for (const k of ['mapped', 'held', 'persisted'] as const) add(k, body[k]);
  }
  return into;
}

async function executeLoopNode(
  node: WorkflowNode,
  ctx: ExecutionContext,
  input: WorkflowItem[],
  nodes: WorkflowNode[],
  info: LoopBody | { error: string },
): Promise<WorkflowItem[]> {
  if ('error' in info) throw new Error(info.error);
  const { bodyNodeIds, bodyEdges } = info;
  const iterNodes = buildIterationNodes(node, bodyNodeIds, nodes);
  const plan = planIterations(node.data as { loopMode?: string; iterations?: number; batchSize?: number }, input);

  const accumulated: WorkflowItem[] = [];
  // Each pass is its own run, whose step results are not kept. What its steps mapped, held and
  // persisted is summed here, so the run still shows rows held inside the loop.
  const bodyCounts: OutcomeCounts = {};
  for (const { index, item, batch } of plan) {
    // NOTE: each iteration re-runs topologicalSort + the loop pre-pass on iterNodes
    // (O(body) per iteration). Acceptable for MVP; revisit if very large bodies with
    // thousands of iterations become a perf concern.
    const result = await runWorkflow(iterNodes, bodyEdges, {
      input: batch,
      services: ctx.services,
      codeLimits: ctx.codeLimits,
      loopMaxItems: ctx.loopMaxItems,
      callStack: ctx.callStack,
      loopVars: [...ctx.loopVars, { index, item }],
      workflowId: ctx.workflowId,
      // Stream body node events to the same sink, but swallow the per-iteration
      // workflow:done so the UI sees one terminal event for the whole run.
      onEvent: (e) => {
        if (e.type === 'workflow:done') return;
        // The synthetic trigger reuses the loop node's id; drop its redundant
        // lifecycle events so only the parent loop node's own start/success show.
        if ((e.type === 'node:start' || e.type === 'node:success') && 'nodeId' in e && e.nodeId === node.id) return;
        ctx.emit(e);
      },
    });
    if (result.status === 'failed') {
      const failed = result.results.find((r) => r.status === 'error');
      throw new Error(`Loop: iteration ${index} failed: ${failed?.error ?? 'unknown error'}`);
    }
    outcomeCounts(result.results, bodyCounts);
    const iterationItems = extractTerminalItems(bodyEdges, result.results);
    if (accumulated.length + iterationItems.length > ctx.loopMaxItems) {
      throw new Error(`Loop: accumulated items exceeded the limit (${ctx.loopMaxItems})`);
    }
    accumulated.push(...iterationItems);
  }
  if (Object.keys(bodyCounts).length > 0) ctx.nodeMeta[node.id] = { iterations: plan.length, bodyCounts };
  return accumulated;
}
