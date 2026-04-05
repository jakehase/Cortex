import { buildCollaborationScorecardSnapshot } from '../service-collaboration-scorecard.mjs';
import { createCollaborationScorecardFixtures } from '../fixtures-collaboration-scorecard.mjs';

export function createCollaborationScorecardPublicRoutes(basePath = '/public/collaboration-scorecard') {
  const snapshot = buildCollaborationScorecardSnapshot();
  const fixtures = createCollaborationScorecardFixtures();
  return [
    { id: 'collaboration-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

