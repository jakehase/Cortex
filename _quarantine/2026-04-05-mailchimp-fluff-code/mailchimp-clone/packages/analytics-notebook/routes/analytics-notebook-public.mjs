import { buildAnalyticsNotebookSnapshot } from '../service-analytics-notebook.mjs';
import { createAnalyticsNotebookFixtures } from '../fixtures-analytics-notebook.mjs';

export function createAnalyticsNotebookPublicRoutes(basePath = '/public/analytics-notebook') {
  const snapshot = buildAnalyticsNotebookSnapshot();
  const fixtures = createAnalyticsNotebookFixtures();
  return [
    { id: 'analytics-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

