import { buildInsightsWorkbenchSnapshot } from '../service-insights-workbench.mjs';
import { createInsightsWorkbenchFixtures } from '../fixtures-insights-workbench.mjs';

export function createInsightsWorkbenchPublicRoutes(basePath = '/public/insights-workbench') {
  const snapshot = buildInsightsWorkbenchSnapshot();
  const fixtures = createInsightsWorkbenchFixtures();
  return [
    { id: 'insights-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

