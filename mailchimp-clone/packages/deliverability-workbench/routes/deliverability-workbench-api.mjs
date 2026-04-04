import { buildDeliverabilityWorkbenchSnapshot, createDeliverabilityWorkbenchApiDocument } from '../service-deliverability-workbench.mjs';

export function createDeliverabilityWorkbenchApiRoutes(basePath = '/api/deliverability-workbench') {
  const snapshot = buildDeliverabilityWorkbenchSnapshot();
  return [
    { id: 'deliverability-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-workbench.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityWorkbenchApiDocument(snapshot) }
  ];
}

