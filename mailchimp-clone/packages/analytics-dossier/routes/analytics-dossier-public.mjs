import { buildAnalyticsDossierSnapshot } from '../service-analytics-dossier.mjs';
import { createAnalyticsDossierFixtures } from '../fixtures-analytics-dossier.mjs';

export function createAnalyticsDossierPublicRoutes(basePath = '/public/analytics-dossier') {
  const snapshot = buildAnalyticsDossierSnapshot();
  const fixtures = createAnalyticsDossierFixtures();
  return [
    { id: 'analytics-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

