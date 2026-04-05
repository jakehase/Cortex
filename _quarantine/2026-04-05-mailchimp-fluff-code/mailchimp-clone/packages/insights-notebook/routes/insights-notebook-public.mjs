import { buildInsightsNotebookSnapshot } from '../service-insights-notebook.mjs';
import { createInsightsNotebookFixtures } from '../fixtures-insights-notebook.mjs';

export function createInsightsNotebookPublicRoutes(basePath = '/public/insights-notebook') {
  const snapshot = buildInsightsNotebookSnapshot();
  const fixtures = createInsightsNotebookFixtures();
  return [
    { id: 'insights-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

