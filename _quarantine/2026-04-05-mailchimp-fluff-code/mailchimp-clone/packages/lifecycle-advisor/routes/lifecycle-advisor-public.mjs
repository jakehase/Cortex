import { buildLifecycleAdvisorSnapshot } from '../service-lifecycle-advisor.mjs';
import { createLifecycleAdvisorFixtures } from '../fixtures-lifecycle-advisor.mjs';

export function createLifecycleAdvisorPublicRoutes(basePath = '/public/lifecycle-advisor') {
  const snapshot = buildLifecycleAdvisorSnapshot();
  const fixtures = createLifecycleAdvisorFixtures();
  return [
    { id: 'lifecycle-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

