import { describe, expect, it } from 'vitest';
import { isSurveyForm, mapsToResource } from './survey-mode';

describe('isSurveyForm', () => {
  it('is true for a Questionnaire form', () => {
    expect(isSurveyForm('Questionnaire')).toBe(true);
  });

  it('is false for a resource form, and for no type at all', () => {
    expect(isSurveyForm('Location')).toBe(false);
    expect(isSurveyForm(null)).toBe(false);
    expect(isSurveyForm(undefined)).toBe(false);
  });
});

describe('mapsToResource', () => {
  it('is true for a resource form', () => {
    expect(mapsToResource('Location')).toBe(true);
  });

  it('is false for no type, a Bundle form and a survey form', () => {
    expect(mapsToResource(null)).toBe(false);
    expect(mapsToResource('Bundle')).toBe(false);
    expect(mapsToResource('Questionnaire')).toBe(false);
  });
});
