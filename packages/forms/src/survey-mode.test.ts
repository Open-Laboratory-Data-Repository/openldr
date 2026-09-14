import { describe, expect, it } from 'vitest';
import { isSurveyForm } from './survey-mode';

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
