import { buildComplianceNotebookSnapshot, createComplianceNotebookRouteSummary } from '../service-compliance-notebook.mjs';

export function createComplianceNotebookRegistryRoutes(basePath = '/registry/compliance-notebook') {
  const snapshot = buildComplianceNotebookSnapshot();
  return [
    { id: 'compliance-notebook.registry.summary', method: 'GET', path: basePath, summary: createComplianceNotebookRouteSummary(snapshot) },
    { id: 'compliance-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

