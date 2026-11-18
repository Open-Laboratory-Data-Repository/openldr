import { formSchemaOf } from './builderModel';
import { describe, expect, it } from 'vitest';
import { createDefaultFormSchema, makeUniqueFieldId, newField } from './builderModel';

describe('builderModel', () => {
  it('creates a default form schema with required fields', () => {
    const schema = createDefaultFormSchema('Specimen intake');
    expect(schema.name).toBe('Specimen intake');
    expect(schema.id).toBe('specimen-intake');
    expect(schema.status).toBe('draft');
    expect(schema.fields).toHaveLength(0);
    expect(schema.sections).toHaveLength(0);
    expect(schema.targetPages).toHaveLength(0);
    expect(schema.active).toBe(true);
    expect(schema.version).toBe(1);
    expect(typeof schema.createdAt).toBe('string');
  });

  it('creates a new field with correct defaults', () => {
    const field = newField('Patient ID', 'text');
    expect(field.id).toBe('patient-id');
    expect(field.displayLabel).toBe('Patient ID');
    expect(field.fieldType).toBe('text');
    expect(field.required).toBe(false);
    expect(field.enabled).toBe(true);
    expect(field.fhirPath).toBeNull();
    expect(field.description).toBeNull();
    expect(field.cardinality).toEqual({ min: 0, max: '1' });
  });

  it('generates slugified ids from display labels', () => {
    expect(newField('Date of Birth', 'date').id).toBe('date-of-birth');
    expect(newField('Lab Result Value', 'number').id).toBe('lab-result-value');
  });

  it('makeUniqueFieldId disambiguates colliding ids', () => {
    const existing = new Set<string>();
    expect(makeUniqueFieldId('new-text-field', existing)).toBe('new-text-field');
    existing.add('new-text-field');
    expect(makeUniqueFieldId('new-text-field', existing)).toBe('new-text-field-2');
    existing.add('new-text-field-2');
    expect(makeUniqueFieldId('new-text-field', existing)).toBe('new-text-field-3');
  });
});

// Load and restore take the form's name the same way (open-items review I2): the stored schema's
// name when it has one, else the form row's name, which the forms list shows.
describe('formSchemaOf', () => {
  it('keeps a stored schema name', () => {
    expect(formSchemaOf({ name: 'Row name', schema: { name: 'Schema name', fields: [] } }).name).toBe('Schema name');
  });
  it('uses the form row name when the stored schema has none or a blank one', () => {
    expect(formSchemaOf({ name: 'Row name', schema: { fields: [] } }).name).toBe('Row name');
    expect(formSchemaOf({ name: 'Row name', schema: { name: '  ', fields: [] } }).name).toBe('Row name');
  });
});
