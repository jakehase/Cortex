import { buildDeliverabilityLedgerSnapshot, createDeliverabilityLedgerApiDocument } from '../service-deliverability-ledger.mjs';

export function createDeliverabilityLedgerApiRoutes(basePath = '/api/deliverability-ledger') {
  const snapshot = buildDeliverabilityLedgerSnapshot();
  return [
    { id: 'deliverability-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-ledger.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityLedgerApiDocument(snapshot) }
  ];
}

