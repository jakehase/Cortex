import { buildRetentionLabSnapshot, createRetentionLabApiDocument } from '../service-retention-lab.mjs';

export function createRetentionLabApiRoutes(basePath = '/api/retention-lab') {
  const snapshot = buildRetentionLabSnapshot();
  return [
    { id: 'retention-lab.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'retention-lab.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'retention-lab.api.document', method: 'GET', path: basePath + '/document', document: createRetentionLabApiDocument(snapshot) }
  ];
}
