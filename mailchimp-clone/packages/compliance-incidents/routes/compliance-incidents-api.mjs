import { buildComplianceIncidentsSnapshot, createComplianceIncidentsApiDocument } from '../service-compliance-incidents.mjs';

export function createComplianceIncidentsApiRoutes(basePath = '/api/compliance-incidents') { const snapshot = buildComplianceIncidentsSnapshot(); return [{ id: 'compliance-incidents.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'compliance-incidents.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'compliance-incidents.api.document', method: 'GET', path: basePath + '/document', document: createComplianceIncidentsApiDocument(snapshot) }]; }

