import { buildExperimentationLedgerSnapshot, createExperimentationLedgerApiDocument } from '../service-experimentation-ledger.mjs';

export function createExperimentationLedgerApiRoutes(basePath = '/api/experimentation-ledger') {
  const snapshot = buildExperimentationLedgerSnapshot();
  return [
    { id: 'experimentation-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-ledger.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationLedgerApiDocument(snapshot) }
  ];
}

