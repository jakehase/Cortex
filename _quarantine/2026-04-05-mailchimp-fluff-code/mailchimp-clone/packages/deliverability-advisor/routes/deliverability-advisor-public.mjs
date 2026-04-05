import { buildDeliverabilityAdvisorSnapshot } from '../service-deliverability-advisor.mjs';
import { createDeliverabilityAdvisorFixtures } from '../fixtures-deliverability-advisor.mjs';

export function createDeliverabilityAdvisorPublicRoutes(basePath = '/public/deliverability-advisor') {
  const snapshot = buildDeliverabilityAdvisorSnapshot();
  const fixtures = createDeliverabilityAdvisorFixtures();
  return [
    { id: 'deliverability-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

