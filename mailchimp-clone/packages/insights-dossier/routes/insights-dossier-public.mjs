import { buildInsightsDossierSnapshot } from '../service-insights-dossier.mjs';
import { createInsightsDossierFixtures } from '../fixtures-insights-dossier.mjs';

export function createInsightsDossierPublicRoutes(basePath = '/public/insights-dossier') {
  const snapshot = buildInsightsDossierSnapshot();
  const fixtures = createInsightsDossierFixtures();
  return [
    { id: 'insights-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

