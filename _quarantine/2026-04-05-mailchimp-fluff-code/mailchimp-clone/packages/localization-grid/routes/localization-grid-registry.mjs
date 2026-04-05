import { buildLocalizationGridSnapshot, createLocalizationGridRouteSummary } from '../service-localization-grid.mjs';

export function createLocalizationGridRegistryRoutes(basePath = '/registry/localization-grid') {
  const snapshot = buildLocalizationGridSnapshot();
  return [
    { id: 'localization-grid.registry.summary', method: 'GET', path: basePath, summary: createLocalizationGridRouteSummary(snapshot) },
    { id: 'localization-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

