import { buildLeadScoringSnapshot } from '../service-lead-scoring.mjs';
import { createLeadScoringFixtures } from '../fixtures-lead-scoring.mjs';

export function createLeadScoringPublicRoutes(basePath = '/public/lead-scoring') {
  const snapshot = buildLeadScoringSnapshot();
  const fixtures = createLeadScoringFixtures();
  return [
    { id: 'lead-scoring.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'lead-scoring.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'lead-scoring.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
