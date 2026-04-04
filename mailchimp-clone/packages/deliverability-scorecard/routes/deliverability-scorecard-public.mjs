import { buildDeliverabilityScorecardSnapshot } from '../service-deliverability-scorecard.mjs';
import { createDeliverabilityScorecardFixtures } from '../fixtures-deliverability-scorecard.mjs';

export function createDeliverabilityScorecardPublicRoutes(basePath = '/public/deliverability-scorecard') {
  const snapshot = buildDeliverabilityScorecardSnapshot();
  const fixtures = createDeliverabilityScorecardFixtures();
  return [
    { id: 'deliverability-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

