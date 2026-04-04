import { buildComplianceNotebookSnapshot } from '../service-compliance-notebook.mjs';
import { createComplianceNotebookFixtures } from '../fixtures-compliance-notebook.mjs';

export function createComplianceNotebookPublicRoutes(basePath = '/public/compliance-notebook') {
  const snapshot = buildComplianceNotebookSnapshot();
  const fixtures = createComplianceNotebookFixtures();
  return [
    { id: 'compliance-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

