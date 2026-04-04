import { buildAnalyticsSentinelSnapshot } from '../service-analytics-sentinel.mjs';
import { createAnalyticsSentinelFixtures } from '../fixtures-analytics-sentinel.mjs';

export function createAnalyticsSentinelPublicRoutes(basePath = '/public/analytics-sentinel') {
  const snapshot = buildAnalyticsSentinelSnapshot();
  const fixtures = createAnalyticsSentinelFixtures();
  return [
    { id: 'analytics-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

