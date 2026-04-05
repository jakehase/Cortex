import { buildLocalizationNavigatorSnapshot, createLocalizationNavigatorRouteSummary } from '../service-localization-navigator.mjs';

export function createLocalizationNavigatorRegistryRoutes(basePath = '/registry/localization-navigator') {
  const snapshot = buildLocalizationNavigatorSnapshot();
  return [
    { id: 'localization-navigator.registry.summary', method: 'GET', path: basePath, summary: createLocalizationNavigatorRouteSummary(snapshot) },
    { id: 'localization-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

