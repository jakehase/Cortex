import { buildAcquisitionVaultSnapshot, createAcquisitionVaultRouteSummary } from '../service-acquisition-vault.mjs';

export function createAcquisitionVaultRegistryRoutes(basePath = '/registry/acquisition-vault') {
  const snapshot = buildAcquisitionVaultSnapshot();
  return [
    { id: 'acquisition-vault.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionVaultRouteSummary(snapshot) },
    { id: 'acquisition-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

