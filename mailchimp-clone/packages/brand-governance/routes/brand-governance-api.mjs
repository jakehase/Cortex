import { buildBrandGovernanceSnapshot, createBrandGovernanceApiDocument } from '../service-brand-governance.mjs';

export function createBrandGovernanceApiRoutes(basePath = '/api/brand-governance') {
  const snapshot = buildBrandGovernanceSnapshot();
  return [
    { id: 'brand-governance.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'brand-governance.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'brand-governance.api.document', method: 'GET', path: basePath + '/document', document: createBrandGovernanceApiDocument(snapshot) }
  ];
}
