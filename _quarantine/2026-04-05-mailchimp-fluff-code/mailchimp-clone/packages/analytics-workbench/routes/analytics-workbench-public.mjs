import { buildAnalyticsWorkbenchSnapshot } from '../service-analytics-workbench.mjs';
import { createAnalyticsWorkbenchFixtures } from '../fixtures-analytics-workbench.mjs';

export function createAnalyticsWorkbenchPublicRoutes(basePath = '/public/analytics-workbench') {
  const snapshot = buildAnalyticsWorkbenchSnapshot();
  const fixtures = createAnalyticsWorkbenchFixtures();
  return [
    { id: 'analytics-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

