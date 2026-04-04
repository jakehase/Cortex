import { buildLocalizationWatchtowerSnapshot, createLocalizationWatchtowerRouteSummary } from '../service-localization-watchtower.mjs';

export function createLocalizationWatchtowerRegistryRoutes(basePath = '/registry/localization-watchtower') {
  const snapshot = buildLocalizationWatchtowerSnapshot();
  return [
    { id: 'localization-watchtower.registry.summary', method: 'GET', path: basePath, summary: createLocalizationWatchtowerRouteSummary(snapshot) },
    { id: 'localization-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

