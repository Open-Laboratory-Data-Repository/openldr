import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { ActionNode } from './action-node';

const renderNode = (action: string) =>
  render(
    <ReactFlowProvider>
      <ActionNode id="a" type="action" data={{ label: 'A', action, config: {} }} selected={false}
        dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
        draggable selectable deletable />
    </ReactFlowProvider>,
  );

describe('ActionNode', () => {
  it('gives Map to FHIR an out and a held handle, with visible labels', () => {
    const { container, getByText } = renderNode('map-to-fhir');
    expect(container.querySelector('[data-handleid="out"]')).not.toBeNull();
    expect(container.querySelector('[data-handleid="held"]')).not.toBeNull();
    expect(getByText('out')).toBeInTheDocument();
    expect(getByText('held')).toBeInTheDocument();
  });

  it('keeps one plain output on any other action', () => {
    const { container } = renderNode('log');
    expect(container.querySelector('[data-handleid="held"]')).toBeNull();
    expect(container.querySelectorAll('.react-flow__handle-right')).toHaveLength(1);
  });
});
