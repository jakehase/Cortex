import { buildInsightsSentinelSnapshot } from '../service-insights-sentinel.mjs';
import { createInsightsSentinelFixtures } from '../fixtures-insights-sentinel.mjs';

export function createInsightsSentinelPublicRoutes(basePath = '/public/insights-sentinel') {
  const snapshot = buildInsightsSentinelSnapshot();
  const fixtures = createInsightsSentinelFixtures();
  return [
    { id: 'insights-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

