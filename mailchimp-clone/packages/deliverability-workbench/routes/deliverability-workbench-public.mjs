import { buildDeliverabilityWorkbenchSnapshot } from '../service-deliverability-workbench.mjs';
import { createDeliverabilityWorkbenchFixtures } from '../fixtures-deliverability-workbench.mjs';

export function createDeliverabilityWorkbenchPublicRoutes(basePath = '/public/deliverability-workbench') {
  const snapshot = buildDeliverabilityWorkbenchSnapshot();
  const fixtures = createDeliverabilityWorkbenchFixtures();
  return [
    { id: 'deliverability-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

