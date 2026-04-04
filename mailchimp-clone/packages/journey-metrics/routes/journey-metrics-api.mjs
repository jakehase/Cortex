import { buildJourneyMetricsSnapshot, createJourneyMetricsApiDocument } from '../service-journey-metrics.mjs';

export function createJourneyMetricsApiRoutes(basePath = '/api/journey-metrics') {
  const snapshot = buildJourneyMetricsSnapshot();
  return [
    { id: 'journey-metrics.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'journey-metrics.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'journey-metrics.api.document', method: 'GET', path: basePath + '/document', document: createJourneyMetricsApiDocument(snapshot) }
  ];
}
