import { buildSupportPlaybooksSnapshot, createSupportPlaybooksApiDocument } from '../service-support-playbooks.mjs';

export function createSupportPlaybooksApiRoutes(basePath = '/api/support-playbooks') {
  const snapshot = buildSupportPlaybooksSnapshot();
  return [
    { id: 'support-playbooks.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'support-playbooks.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'support-playbooks.api.document', method: 'GET', path: basePath + '/document', document: createSupportPlaybooksApiDocument(snapshot) }
  ];
}
