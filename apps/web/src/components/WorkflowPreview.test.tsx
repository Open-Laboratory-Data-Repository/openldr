import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { WorkflowPreview } from './WorkflowPreview';
import { WORKFLOW_STAGE } from '@/landing/workflow-preview-model';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges }: { nodes: Array<{ id: string; data: { label: string } }>; edges: Array<{ id: string }> }) => (
    <div>
      {nodes.map((node) => <span key={node.id}>{node.data.label}</span>)}
      {edges.map((edge) => <span key={edge.id} data-testid="workflow-edge" />)}
    </div>
  ),
  Handle: () => null,
  BaseEdge: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right' },
  getBezierPath: () => ['M0,0'],
}));

describe('WorkflowPreview', () => {
  it('renders the default OpenLDR ingest workflow without editor controls', () => {
    render(<WorkflowPreview />);

    expect(screen.getByLabelText(/openldr ingest workflow/i)).toBeInTheDocument();
    expect(screen.getByText('Ingest received')).toBeInTheDocument();
    expect(screen.getByText('Route by payload shape')).toBeInTheDocument();
    expect(screen.getByText('Unwrap FHIR Bundle')).toBeInTheDocument();
    expect(screen.getByText('Validate form answers')).toBeInTheDocument();
    expect(screen.getByText('Persist store')).toBeInTheDocument();
    expect(screen.getByText('Log persisted')).toBeInTheDocument();
    expect(screen.getAllByTestId('workflow-edge')).toHaveLength(6);
    expect(screen.queryByLabelText(/zoom in/i)).not.toBeInTheDocument();
    // No overlaid title or status chrome — the section copy above the canvas carries that.
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
  });

  it('draws the diagram on a fixed stage that is scaled, not scrolled', () => {
    const { container } = render(<WorkflowPreview />);
    const stage = container.querySelector<HTMLElement>('.workflow-preview-stage');

    expect(stage).not.toBeNull();
    expect(stage?.style.width).toBe(`${WORKFLOW_STAGE.width}px`);
    expect(stage?.style.transform).toBe('scale(1)');
    // No inner scroll container: the page scrolls, the canvas does not.
    expect(container.querySelector('.workflow-preview-scroll')).toBeNull();
  });
});
