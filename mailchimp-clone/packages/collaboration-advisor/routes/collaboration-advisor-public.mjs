import { buildCollaborationAdvisorSnapshot } from '../service-collaboration-advisor.mjs';
import { createCollaborationAdvisorFixtures } from '../fixtures-collaboration-advisor.mjs';

export function createCollaborationAdvisorPublicRoutes(basePath = '/public/collaboration-advisor') {
  const snapshot = buildCollaborationAdvisorSnapshot();
  const fixtures = createCollaborationAdvisorFixtures();
  return [
    { id: 'collaboration-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

