import { buildLocalizationIndexSnapshot, createLocalizationIndexRouteSummary } from '../service-localization-index.mjs';

export function createLocalizationIndexRegistryRoutes(basePath = '/registry/localization-index') {
  const snapshot = buildLocalizationIndexSnapshot();
  return [
    { id: 'localization-index.registry.summary', method: 'GET', path: basePath, summary: createLocalizationIndexRouteSummary(snapshot) },
    { id: 'localization-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

