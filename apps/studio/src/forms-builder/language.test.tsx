import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import type { FormField, FormLintIssue, FormSchema } from '@openldr/forms/pure';
import i18n from '@/i18n';
import { BuilderHeader } from './BuilderHeader';
import { FieldEditorSheet } from './FieldEditorSheet';
import { LintSummary } from './LintSummary';
import { SortableFieldRow } from './SortableFieldRow';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listCodingSystems: vi.fn(async () => []),
  codeSuggestions: vi.fn(async () => []),
  listValueSets: vi.fn(async () => []),
  findValueSetByUrl: vi.fn(async () => null),
  storedValueSetCodes: vi.fn(async () => []),
}));

/**
 * The Form Builder used to stay in English whatever language the studio was set to. These render
 * the builder's main screens in French and Portuguese and look for the translated words.
 */

const SCHEMA: FormSchema = {
  id: 'f', name: 'My Form', versionLabel: 'v1', fhirVersion: null, fhirResourceType: null, fhirProfileUrl: null,
  facilityId: null, fields: [], sections: [], targetPages: [], languages: [], version: 1, active: true,
  status: 'draft', createdAt: '', updatedAt: '',
};

const FIELD: FormField = {
  id: 'f-1', displayLabel: 'Patient name', fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
};

const noop = () => {};

function header() {
  render(
    <BuilderHeader
      schema={SCHEMA} issues={[]} canPublish formId="f" onChange={noop} onSave={noop} onPublish={noop}
      onCompare={noop} onVersions={noop} onAddField={noop} onPreview={noop} onArchive={noop} onDisable={noop}
      onDelete={noop} onExport={noop}
    />,
  );
}

function row(lintIssue: FormLintIssue) {
  return render(
    <DndContext>
      <SortableContext items={[FIELD.id]}>
        <SortableFieldRow
          field={FIELD} selected={false} lintIssue={lintIssue} onSelect={noop} onToggleEnabled={noop}
          onToggleRequired={noop} onDuplicate={noop} onDelete={noop}
        />
      </SortableContext>
    </DndContext>,
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('the Form Builder in French', () => {
  it('labels the header in French', async () => {
    await i18n.changeLanguage('fr');
    header();
    expect(screen.getByText('Nom du formulaire')).toBeInTheDocument();
    expect(screen.getByText('Pages cibles')).toBeInTheDocument();
    expect(screen.getByText('Type de ressource')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions du générateur' })).toBeInTheDocument();
  });

  it('labels the field editor in French, field types included', async () => {
    await i18n.changeLanguage('fr');
    render(
      <FieldEditorSheet
        field={FIELD} allFields={[FIELD]} sections={[]} fhirResourceType={null} open
        onOpenChange={noop} onSave={noop} onCancel={noop}
      />,
    );
    expect(screen.getByText('Modifier le champ')).toBeInTheDocument();
    expect(screen.getByLabelText('Libellé affiché')).toBeInTheDocument();
    expect(screen.getByText('Correspondance')).toBeInTheDocument();
    expect(screen.getByText('Visibilité')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Type de champ' })).toHaveTextContent('texte');
  });

  it('counts lint findings in French', async () => {
    await i18n.changeLanguage('fr');
    const issues: FormLintIssue[] = [
      { severity: 'error', code: 'duplicate-id', message: 'Duplicate field id "a"', fieldId: 'a' },
      { severity: 'error', code: 'duplicate-id', message: 'Duplicate field id "a"', fieldId: 'a' },
      { severity: 'warning', code: 'fhir-path-cardinality', message: 'x', fieldId: 'b' },
    ];
    render(<LintSummary issues={issues} />);
    expect(screen.getByRole('status')).toHaveTextContent('2 erreurs, 1 avertissement');
  });

  it('explains a lint finding in French, and keeps the detailed English message in English', async () => {
    const issue: FormLintIssue = { severity: 'warning', code: 'fhir-path-cardinality', message: 'Field "b" binds "Patient.name"', fieldId: 'b' };
    await i18n.changeLanguage('fr');
    const first = row(issue);
    expect(screen.getByTitle('Le champ « b » pointe dans une liste répétée sans dire quelle entrée.')).toBeInTheDocument();
    first.unmount();
    await i18n.changeLanguage('en');
    row(issue);
    expect(screen.getByTitle('Field "b" binds "Patient.name"')).toBeInTheDocument();
  });
});

describe('the Form Builder in Portuguese', () => {
  it('labels the header in European Portuguese', async () => {
    await i18n.changeLanguage('pt');
    header();
    expect(screen.getByText('Nome do formulário')).toBeInTheDocument();
    expect(screen.getByText('Páginas de destino')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ações do construtor' })).toBeInTheDocument();
  });
});
