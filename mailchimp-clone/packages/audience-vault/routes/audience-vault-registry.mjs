import { buildAudienceVaultSnapshot, createAudienceVaultRouteSummary } from '../service-audience-vault.mjs';

export function createAudienceVaultRegistryRoutes(basePath = '/registry/audience-vault') {
  const snapshot = buildAudienceVaultSnapshot();
  return [
    { id: 'audience-vault.registry.summary', method: 'GET', path: basePath, summary: createAudienceVaultRouteSummary(snapshot) },
    { id: 'audience-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

