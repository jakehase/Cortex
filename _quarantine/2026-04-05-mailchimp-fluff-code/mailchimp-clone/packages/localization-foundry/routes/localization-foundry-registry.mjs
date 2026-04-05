import { buildLocalizationFoundrySnapshot, createLocalizationFoundryRouteSummary } from '../service-localization-foundry.mjs';

export function createLocalizationFoundryRegistryRoutes(basePath = '/registry/localization-foundry') {
  const snapshot = buildLocalizationFoundrySnapshot();
  return [
    { id: 'localization-foundry.registry.summary', method: 'GET', path: basePath, summary: createLocalizationFoundryRouteSummary(snapshot) },
    { id: 'localization-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

