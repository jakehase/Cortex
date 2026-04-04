import { buildConsentFoundrySnapshot, createConsentFoundryRouteSummary } from '../service-consent-foundry.mjs';

export function createConsentFoundryRegistryRoutes(basePath = '/registry/consent-foundry') {
  const snapshot = buildConsentFoundrySnapshot();
  return [
    { id: 'consent-foundry.registry.summary', method: 'GET', path: basePath, summary: createConsentFoundryRouteSummary(snapshot) },
    { id: 'consent-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

