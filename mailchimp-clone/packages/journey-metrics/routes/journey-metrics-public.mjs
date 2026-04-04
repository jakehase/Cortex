import { buildJourneyMetricsSnapshot } from '../service-journey-metrics.mjs';
import { createJourneyMetricsFixtures } from '../fixtures-journey-metrics.mjs';

export function createJourneyMetricsPublicRoutes(basePath = '/public/journey-metrics') {
  const snapshot = buildJourneyMetricsSnapshot();
  const fixtures = createJourneyMetricsFixtures();
  return [
    { id: 'journey-metrics.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'journey-metrics.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'journey-metrics.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
