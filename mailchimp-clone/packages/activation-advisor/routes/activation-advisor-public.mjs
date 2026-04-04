import { buildActivationAdvisorSnapshot } from '../service-activation-advisor.mjs';
import { createActivationAdvisorFixtures } from '../fixtures-activation-advisor.mjs';

export function createActivationAdvisorPublicRoutes(basePath = '/public/activation-advisor') {
  const snapshot = buildActivationAdvisorSnapshot();
  const fixtures = createActivationAdvisorFixtures();
  return [
    { id: 'activation-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

