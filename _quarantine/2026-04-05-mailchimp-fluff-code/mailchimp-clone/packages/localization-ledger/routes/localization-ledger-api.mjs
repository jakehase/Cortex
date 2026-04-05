import { buildLocalizationLedgerSnapshot, createLocalizationLedgerApiDocument } from '../service-localization-ledger.mjs';

export function createLocalizationLedgerApiRoutes(basePath = '/api/localization-ledger') {
  const snapshot = buildLocalizationLedgerSnapshot();
  return [
    { id: 'localization-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-ledger.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationLedgerApiDocument(snapshot) }
  ];
}

