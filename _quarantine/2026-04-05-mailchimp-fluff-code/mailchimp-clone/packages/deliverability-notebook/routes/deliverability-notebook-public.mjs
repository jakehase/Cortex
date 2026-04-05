import { buildDeliverabilityNotebookSnapshot } from '../service-deliverability-notebook.mjs';
import { createDeliverabilityNotebookFixtures } from '../fixtures-deliverability-notebook.mjs';

export function createDeliverabilityNotebookPublicRoutes(basePath = '/public/deliverability-notebook') {
  const snapshot = buildDeliverabilityNotebookSnapshot();
  const fixtures = createDeliverabilityNotebookFixtures();
  return [
    { id: 'deliverability-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

