import { buildInboxMacrosSnapshot, createInboxMacrosApiDocument } from '../service-inbox-macros.mjs';

export function createInboxMacrosApiRoutes(basePath = '/api/inbox-macros') {
  const snapshot = buildInboxMacrosSnapshot();
  return [
    { id: 'inbox-macros.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'inbox-macros.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'inbox-macros.api.document', method: 'GET', path: basePath + '/document', document: createInboxMacrosApiDocument(snapshot) }
  ];
}
