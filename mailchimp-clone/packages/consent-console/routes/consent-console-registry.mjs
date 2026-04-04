import { buildConsentConsoleSnapshot, createConsentConsoleRouteSummary } from '../service-consent-console.mjs';

export function createConsentConsoleRegistryRoutes(basePath = '/registry/consent-console') {
  const snapshot = buildConsentConsoleSnapshot();
  return [
    { id: 'consent-console.registry.summary', method: 'GET', path: basePath, summary: createConsentConsoleRouteSummary(snapshot) },
    { id: 'consent-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

