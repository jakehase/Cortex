import { buildDeliverabilityNotebookSnapshot, createDeliverabilityNotebookApiDocument } from '../service-deliverability-notebook.mjs';

export function createDeliverabilityNotebookApiRoutes(basePath = '/api/deliverability-notebook') {
  const snapshot = buildDeliverabilityNotebookSnapshot();
  return [
    { id: 'deliverability-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-notebook.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityNotebookApiDocument(snapshot) }
  ];
}

