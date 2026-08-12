import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ClipboardCheck,
  Database,
  GitFork,
  PackageOpen,
  Terminal,
  Webhook,
  type LucideProps,
} from 'lucide-react';
import {
  WORKFLOW_STAGE,
  nextWorkflowFrame,
  workflowFrameDuration,
  workflowStageScale,
  type WorkflowFrame,
} from '@/landing/workflow-preview-model';

type WorkflowNodeId = 'received' | 'route' | 'upper' | 'lower' | 'persist' | 'log';
type WorkflowIcon = ComponentType<LucideProps>;

interface WorkflowNodeBaseData {
  icon: WorkflowIcon;
  label: string;
  subtitle: string;
  variant?: 'route';
  running: boolean;
  complete: boolean;
}

type WorkflowNodeData = WorkflowNodeBaseData & Record<string, unknown>;

const routeEdges = {
  upper: ['received-route', 'route-upper', 'upper-persist', 'persist-log'],
  lower: ['received-route', 'route-lower', 'lower-persist', 'persist-log'],
} as const;

const edgeTargets: Record<string, WorkflowNodeId> = {
  'received-route': 'route',
  'route-upper': 'upper',
  'route-lower': 'lower',
  'upper-persist': 'persist',
  'lower-persist': 'persist',
  'persist-log': 'log',
};

type WorkflowPreviewNode = Node<WorkflowNodeData, 'workflow'>;

function WorkflowNode({ data }: NodeProps<WorkflowPreviewNode>) {
  const Icon = data.icon as WorkflowIcon;

  return (
    <div className={`workflow-preview-node ${data.variant ?? ''}`}>
      <div className={`workflow-preview-card ${data.complete ? 'complete' : ''} ${data.running ? 'running' : ''}`}>
        {data.running ? (
          <svg className="workflow-preview-progress" viewBox="0 0 84 84" aria-hidden="true">
            <rect x="4" y="4" width="76" height="76" rx="15" pathLength="1" />
          </svg>
        ) : null}
        <Handle type="target" position={Position.Left} />
        <Icon aria-hidden="true" />
        <Handle type="source" position={Position.Right} />
      </div>
      <span className="workflow-preview-label">{data.label}</span>
      <span className="workflow-preview-subtitle">{data.subtitle}</span>
    </div>
  );
}

function WorkflowEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const active = Boolean((data as { active?: boolean } | undefined)?.active);

  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: '#95a4ba', strokeWidth: 2 }} />
      <g data-testid="workflow-edge">
        {active ? (
          <circle className="workflow-preview-packet" r="6">
            <animateMotion path={path} dur="1.45s" fill="freeze" repeatCount={1} />
          </circle>
        ) : null}
      </g>
    </>
  );
}

const nodeTypes = { workflow: WorkflowNode };
const edgeTypes = { workflow: WorkflowEdge };

function completedNodeIds(frame: WorkflowFrame): Set<WorkflowNodeId> {
  const sequence = routeEdges[frame.route];
  const completed = new Set<WorkflowNodeId>();
  const sourceCount = frame.phase === 'flow' ? frame.step + 1 : frame.step;

  for (let index = 0; index < sourceCount; index += 1) {
    const edgeId = sequence[index];
    if (edgeId) completed.add(edgeId.split('-')[0] as WorkflowNodeId);
  }

  if (frame.step === 4) completed.add('log');
  return completed;
}

function activeNodeId(frame: WorkflowFrame): WorkflowNodeId | null {
  if (frame.phase !== 'node' || frame.step === 4) return null;
  return routeEdges[frame.route][frame.step].split('-')[0] as WorkflowNodeId;
}

function createNodes(frame: WorkflowFrame): WorkflowPreviewNode[] {
  const complete = completedNodeIds(frame);
  const running = activeNodeId(frame);
  const node = (id: WorkflowNodeId, position: { x: number; y: number }, data: Omit<WorkflowNodeBaseData, 'complete' | 'running'>): WorkflowPreviewNode => ({
    id,
    type: 'workflow',
    position,
    data: { ...data, complete: complete.has(id), running: running === id },
  });

  return [
    node('received', { x: 16, y: 180 }, { icon: Webhook, label: 'Ingest received', subtitle: 'webhook' }),
    node('route', { x: 220, y: 180 }, { icon: GitFork, label: 'Route by payload shape', subtitle: '1 rule', variant: 'route' }),
    node('upper', { x: 440, y: 16 }, { icon: PackageOpen, label: 'Unwrap FHIR Bundle', subtitle: 'unwrap-bundle' }),
    node('lower', { x: 440, y: 344 }, { icon: ClipboardCheck, label: 'Validate form answers', subtitle: 'form-validate' }),
    node('persist', { x: 688, y: 180 }, { icon: Database, label: 'Persist store', subtitle: 'persist-store' }),
    node('log', { x: 928, y: 180 }, { icon: Terminal, label: 'Log persisted', subtitle: 'log' }),
  ];
}

function createEdges(frame: WorkflowFrame): Array<Edge> {
  const activeEdge = frame.phase === 'flow' && frame.step < 4
    ? routeEdges[frame.route][frame.step as 0 | 1 | 2 | 3]
    : null;
  const edge = (id: string, source: WorkflowNodeId, target: WorkflowNodeId): Edge => ({
    id,
    source,
    target,
    type: 'workflow',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#95a4ba', width: 16, height: 16 },
    data: { active: id === activeEdge },
  });

  return [
    edge('received-route', 'received', 'route'),
    edge('route-upper', 'route', 'upper'),
    edge('route-lower', 'route', 'lower'),
    edge('upper-persist', 'upper', 'persist'),
    edge('lower-persist', 'lower', 'persist'),
    edge('persist-log', 'persist', 'log'),
  ];
}

// The canvas has no scrollbar of its own, so the diagram has to fit the width the page gives
// it. React Flow's `fitView` does not do that here — it leaves the viewport at scale 1, which
// is what pushed the last node off the old canvas and put a scrollbar under it. So the diagram
// is drawn at its fixed WORKFLOW_STAGE size and the whole stage is scaled with CSS instead.
// Re-measure on both ResizeObserver and window resize: the observer catches a pane that
// changes width without the window changing, the event covers environments that never
// deliver observer callbacks.
function WorkflowCanvas({ nodes, edges }: { nodes: WorkflowPreviewNode[]; edges: Edge[] }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const measure = () => setScale(workflowStageScale(element.clientWidth));
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="workflow-preview-canvas" ref={wrapper} style={{ height: WORKFLOW_STAGE.height * scale }}>
      <div
        className="workflow-preview-stage"
        style={{ width: WORKFLOW_STAGE.width, height: WORKFLOW_STAGE.height, transform: `scale(${scale})` }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  );
}

export function WorkflowPreview() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [frame, setFrame] = useState<WorkflowFrame>({ route: 'upper', step: 0, phase: 'node', run: 0 });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timeout = window.setTimeout(() => setFrame(nextWorkflowFrame), workflowFrameDuration(frame));
    return () => window.clearTimeout(timeout);
  }, [frame, reducedMotion]);

  const visibleFrame = reducedMotion
    ? { route: 'upper' as const, step: 4 as const, phase: 'node' as const, run: 0 }
    : frame;
  const nodes = useMemo(() => createNodes(visibleFrame), [visibleFrame]);
  const edges = useMemo(() => createEdges(visibleFrame), [visibleFrame]);

  return (
    <section className="workflow-preview-shell" aria-label="OpenLDR ingest workflow">
      <WorkflowCanvas nodes={nodes} edges={edges} />
      <style>{`
        .workflow-preview-shell { position: relative; overflow: hidden; background: transparent; color: var(--text); }
        .workflow-preview-canvas { position: relative; z-index: 1; display: flex; justify-content: center; }
        .workflow-preview-stage { flex: none; transform-origin: top center; }
        .workflow-preview-shell .react-flow__node { pointer-events: none; }
        .workflow-preview-shell .react-flow__edge-path { fill: none; stroke: #95a4ba; stroke-width: 2; }
        .workflow-preview-node { width: 132px; display: flex; flex-direction: column; align-items: center; color: var(--text); text-align: center; }
        .workflow-preview-card { position: relative; display: grid; width: 76px; height: 76px; place-items: center; border: 2px solid #393939; border-radius: 15px; background: linear-gradient(145deg, #272727, #1c1c1c); box-shadow: 0 8px 22px rgba(0, 0, 0, .34), inset 0 1px rgba(255, 255, 255, .05); transition: border-color .22s ease, box-shadow .22s ease; }
        .workflow-preview-card.complete { border-color: #22c55e; box-shadow: 0 0 0 1px rgba(34, 197, 94, .22), 0 0 14px rgba(34, 197, 94, .18), inset 0 1px rgba(255, 255, 255, .05); }
        .workflow-preview-card.running { border-color: #393939; }
        .workflow-preview-card > svg:not(.workflow-preview-progress) { width: 34px; height: 34px; color: #29bdf3; stroke-width: 2.3; }
        .workflow-preview-node.route .workflow-preview-card > svg:not(.workflow-preview-progress) { color: #f6b100; }
        .workflow-preview-shell .react-flow__handle { width: 12px; height: 12px; border: 2px solid var(--bg); background: #25bdf3; }
        .workflow-preview-node.route .react-flow__handle { background: #f4a900; }
        .workflow-preview-progress { position: absolute; inset: -5px; width: 84px; height: 84px; overflow: visible; pointer-events: none; }
        .workflow-preview-progress rect { fill: none; stroke: #25bdf3; stroke-width: 3; stroke-linecap: round; stroke-dasharray: .23 .77; animation: workflow-preview-border-progress 1.15s linear infinite; }
        .workflow-preview-label { margin-top: 9px; font-size: 12px; font-weight: 600; line-height: 1.2; white-space: nowrap; }
        .workflow-preview-subtitle { margin-top: 4px; color: #999; font-size: 10px; line-height: 1.2; }
        .workflow-preview-packet { fill: #22c55e; stroke: #a6fac2; stroke-width: 1.4; filter: drop-shadow(0 0 9px rgba(34, 197, 94, .95)); }
        @keyframes workflow-preview-border-progress { to { stroke-dashoffset: -1; } }
        @media (prefers-reduced-motion: reduce) { .workflow-preview-progress rect { animation: none; } }
      `}</style>
    </section>
  );
}
