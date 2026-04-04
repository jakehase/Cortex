import { buildCollaborationPlannerSnapshot } from '../service-collaboration-planner.mjs';
import { createCollaborationPlannerFixtures } from '../fixtures-collaboration-planner.mjs';

export function createCollaborationPlannerPublicRoutes(basePath = '/public/collaboration-planner') {
  const snapshot = buildCollaborationPlannerSnapshot();
  const fixtures = createCollaborationPlannerFixtures();
  return [
    { id: 'collaboration-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

