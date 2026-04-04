import { buildSupportPlaybooksSnapshot } from '../service-support-playbooks.mjs';
import { createSupportPlaybooksFixtures } from '../fixtures-support-playbooks.mjs';

export function createSupportPlaybooksPublicRoutes(basePath = '/public/support-playbooks') {
  const snapshot = buildSupportPlaybooksSnapshot();
  const fixtures = createSupportPlaybooksFixtures();
  return [
    { id: 'support-playbooks.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'support-playbooks.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'support-playbooks.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
