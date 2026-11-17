import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ActionNodeData } from '../../lib/types';
import { NodeShell } from './base-node';

/** The Map to FHIR node's two outputs, as the engine names them (`out` and `held`). */
function MapToFhirHandles() {
  const { t } = useTranslation();
  const ports = [
    { id: 'out', top: '30%', label: t('workflows.mapToFhir.portOut'), bg: '!bg-emerald-500' },
    { id: 'held', top: '70%', label: t('workflows.mapToFhir.portHeld'), bg: '!bg-amber-500' },
  ];
  return (
    <>
      {ports.map((p) => (
        <Handle
          key={p.id}
          type="source"
          position={Position.Right}
          id={p.id}
          style={{ top: p.top }}
          className={`!h-3.5 !w-3.5 !rounded-full !border-2 !border-background ${p.bg} transition-all hover:!h-4 hover:!w-4`}
          title={p.label}
        />
      ))}
      {ports.map((p) => (
        <span
          key={`${p.id}-label`}
          aria-hidden="true"
          style={{ top: p.top }}
          className="pointer-events-none absolute left-full ml-2.5 -translate-y-1/2 text-[9px] leading-none text-muted-foreground"
        >
          {p.label}
        </span>
      ))}
    </>
  );
}

export function ActionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ActionNodeData;
  const isMapToFhir = nodeData.action === 'map-to-fhir';
  return (
    <NodeShell
      id={id}
      variant="action"
      icon={Send}
      iconName={nodeData.iconName}
      iconUrl={nodeData.iconUrl}
      label={nodeData.label}
      subtitle={nodeData.action}
      selected={selected}
      hasOutput={!isMapToFhir}
      extraHandles={isMapToFhir ? <MapToFhirHandles /> : undefined}
    />
  );
}
