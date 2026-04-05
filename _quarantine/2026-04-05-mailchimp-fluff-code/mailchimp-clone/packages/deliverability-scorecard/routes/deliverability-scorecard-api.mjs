import { buildDeliverabilityScorecardSnapshot, createDeliverabilityScorecardApiDocument } from '../service-deliverability-scorecard.mjs';

export function createDeliverabilityScorecardApiRoutes(basePath = '/api/deliverability-scorecard') {
  const snapshot = buildDeliverabilityScorecardSnapshot();
  return [
    { id: 'deliverability-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'deliverability-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'deliverability-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'deliverability-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityScorecardApiDocument(snapshot) }
  ];
}

