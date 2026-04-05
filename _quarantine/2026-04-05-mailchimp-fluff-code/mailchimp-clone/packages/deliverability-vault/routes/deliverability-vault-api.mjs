import { buildDeliverabilityVaultSnapshot, createDeliverabilityVaultApiDocument } from '../service-deliverability-vault.mjs';

export function createDeliverabilityVaultApiRoutes(basePath = '/api/deliverability-vault') {
  const snapshot = buildDeliverabilityVaultSnapshot();
  return [
    { id: 'deliverability-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-vault.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityVaultApiDocument(snapshot) }
  ];
}

