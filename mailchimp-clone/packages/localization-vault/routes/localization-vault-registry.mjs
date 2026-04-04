import { buildLocalizationVaultSnapshot, createLocalizationVaultRouteSummary } from '../service-localization-vault.mjs';

export function createLocalizationVaultRegistryRoutes(basePath = '/registry/localization-vault') {
  const snapshot = buildLocalizationVaultSnapshot();
  return [
    { id: 'localization-vault.registry.summary', method: 'GET', path: basePath, summary: createLocalizationVaultRouteSummary(snapshot) },
    { id: 'localization-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

