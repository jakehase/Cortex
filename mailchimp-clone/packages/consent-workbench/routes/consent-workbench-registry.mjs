import { buildConsentWorkbenchSnapshot, createConsentWorkbenchRouteSummary } from '../service-consent-workbench.mjs';

export function createConsentWorkbenchRegistryRoutes(basePath = '/registry/consent-workbench') {
  const snapshot = buildConsentWorkbenchSnapshot();
  return [
    { id: 'consent-workbench.registry.summary', method: 'GET', path: basePath, summary: createConsentWorkbenchRouteSummary(snapshot) },
    { id: 'consent-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

