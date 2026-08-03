import type { Provenance } from '../provenance';
import type { ExternalSchema } from '../schema/external';
import { projectPatient } from './patient';
import { projectServiceRequest } from './service-request';
import { projectObservation } from './observation';
import { projectFacility } from './facility';
import { projectSpecimen } from './specimen';
import { projectDiagnosticReport } from './diagnostic-report';
import { projectQuestionnaireResponse } from './questionnaire-response';

export * from './patient';
export * from './service-request';
export * from './observation';
export * from './facility';
export * from './specimen';
export * from './diagnostic-report';
export * from './questionnaire-response';

export interface RelationalResult {
  table: keyof ExternalSchema;
  /** One row for a fact resource; many for a resource that fans out to a dimension. */
  rows: Record<string, unknown>[];
  /** Present only for fan-out resources. Names the column identifying every row this resource
   *  owns, so the writer can REPLACE that set — deleting rows the resource no longer produces.
   *  Without it a shrinking ValueSet would silently leave its removed codes behind. */
  scope?: { column: string; value: unknown };
}

export function projectResource(resource: unknown, prov: Provenance = {}): RelationalResult | null {
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'Patient': return { table: 'patients', rows: [projectPatient(r, prov)] };
    case 'ServiceRequest': return { table: 'lab_requests', rows: [projectServiceRequest(r, prov)] };
    case 'Observation': return { table: 'lab_results', rows: [projectObservation(r, prov)] };
    case 'Organization':
    case 'Location': return { table: 'facilities', rows: [projectFacility(r, prov)] };
    case 'Specimen': return { table: 'specimens', rows: [projectSpecimen(r, prov)] };
    case 'DiagnosticReport': return { table: 'diagnostic_reports', rows: [projectDiagnosticReport(r, prov)] };
    case 'QuestionnaireResponse': return { table: 'questionnaire_responses', rows: [projectQuestionnaireResponse(r, prov)] };
    default: return null;
  }
}

export function tableForResourceType(resourceType: string): keyof ExternalSchema | null {
  switch (resourceType) {
    case 'Patient': return 'patients';
    case 'ServiceRequest': return 'lab_requests';
    case 'Observation': return 'lab_results';
    case 'Organization':
    case 'Location': return 'facilities';
    case 'Specimen': return 'specimens';
    case 'DiagnosticReport': return 'diagnostic_reports';
    case 'QuestionnaireResponse': return 'questionnaire_responses';
    default: return null;
  }
}
