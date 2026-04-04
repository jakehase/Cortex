import { buildLocalizationHubSnapshot, createLocalizationHubRouteSummary } from '../service-localization-hub.mjs';

export function createLocalizationHubRegistryRoutes(basePath = '/registry/localization-hub') {
  const snapshot = buildLocalizationHubSnapshot();
  return [
    { id: 'localization-hub.registry.summary', method: 'GET', path: basePath, summary: createLocalizationHubRouteSummary(snapshot) },
    { id: 'localization-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

