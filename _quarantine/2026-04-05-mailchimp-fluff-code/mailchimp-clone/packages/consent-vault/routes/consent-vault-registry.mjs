import { buildConsentVaultSnapshot, createConsentVaultRouteSummary } from '../service-consent-vault.mjs';

export function createConsentVaultRegistryRoutes(basePath = '/registry/consent-vault') {
  const snapshot = buildConsentVaultSnapshot();
  return [
    { id: 'consent-vault.registry.summary', method: 'GET', path: basePath, summary: createConsentVaultRouteSummary(snapshot) },
    { id: 'consent-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

