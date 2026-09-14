import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SectionDropPanel, dropAction, parseSectionDropTargetId, sectionDropTargetId } from './SectionDropPanel';

describe('section drop targets', () => {
  it('round-trips a section id and the no-section bucket', () => {
    expect(parseSectionDropTargetId(sectionDropTargetId('vitals'))).toBe('vitals');
    expect(parseSectionDropTargetId(sectionDropTargetId(undefined))).toBeUndefined();
    expect(parseSectionDropTargetId('field-1')).toBeNull();
  });
});

describe('dropAction', () => {
  it('reassigns on a section target, reorders on a field, and does nothing otherwise', () => {
    expect(dropAction('a', sectionDropTargetId('vitals'))).toEqual({ kind: 'section', fieldId: 'a', sectionId: 'vitals' });
    expect(dropAction('a', sectionDropTargetId(undefined))).toEqual({ kind: 'section', fieldId: 'a', sectionId: undefined });
    expect(dropAction('a', 'b')).toEqual({ kind: 'reorder', activeId: 'a', overId: 'b' });
    expect(dropAction('a', 'a')).toBeNull();
    expect(dropAction('a', null)).toBeNull();
  });
});

describe('SectionDropPanel', () => {
  const renderPanel = (visible: boolean) =>
    render(
      <DndContext>
        <SectionDropPanel
          visible={visible}
          sections={[{ id: 'vitals', label: 'Vitals', order: 0 }]}
          fieldCountBySection={{ vitals: 2 }}
          unsectionedCount={1}
        />
      </DndContext>,
    );

  it('lists (no section) and each section with a count', () => {
    renderPanel(true);
    expect(screen.getByText('Drop on a section to reassign')).toBeTruthy();
    expect(screen.getByText('(no section)')).toBeTruthy();
    expect(screen.getByText('Vitals').nextSibling?.textContent).toBe('2');
  });

  it('is hidden from assistive tech while no drag is on', () => {
    renderPanel(false);
    expect(screen.getByText('Drop on a section to reassign').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
  });
});
