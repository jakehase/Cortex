import { buildDeliverabilityDossierSnapshot, createDeliverabilityDossierApiDocument } from '../service-deliverability-dossier.mjs';

export function createDeliverabilityDossierApiRoutes(basePath = '/api/deliverability-dossier') {
  const snapshot = buildDeliverabilityDossierSnapshot();
  return [
    { id: 'deliverability-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-dossier.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityDossierApiDocument(snapshot) }
  ];
}

