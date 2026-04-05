import { buildIntegrationsAdvisorSnapshot } from '../service-integrations-advisor.mjs';
import { createIntegrationsAdvisorFixtures } from '../fixtures-integrations-advisor.mjs';

export function createIntegrationsAdvisorPublicRoutes(basePath = '/public/integrations-advisor') {
  const snapshot = buildIntegrationsAdvisorSnapshot();
  const fixtures = createIntegrationsAdvisorFixtures();
  return [
    { id: 'integrations-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

