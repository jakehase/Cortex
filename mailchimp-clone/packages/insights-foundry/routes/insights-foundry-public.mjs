import { buildInsightsFoundrySnapshot } from '../service-insights-foundry.mjs';
import { createInsightsFoundryFixtures } from '../fixtures-insights-foundry.mjs';

export function createInsightsFoundryPublicRoutes(basePath = '/public/insights-foundry') {
  const snapshot = buildInsightsFoundrySnapshot();
  const fixtures = createInsightsFoundryFixtures();
  return [
    { id: 'insights-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

