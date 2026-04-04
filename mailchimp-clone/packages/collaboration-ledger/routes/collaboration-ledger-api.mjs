import { buildCollaborationLedgerSnapshot, createCollaborationLedgerApiDocument } from '../service-collaboration-ledger.mjs';

export function createCollaborationLedgerApiRoutes(basePath = '/api/collaboration-ledger') {
  const snapshot = buildCollaborationLedgerSnapshot();
  return [
    { id: 'collaboration-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-ledger.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationLedgerApiDocument(snapshot) }
  ];
}

