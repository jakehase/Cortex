import { buildLocalizationAtlasSnapshot, createLocalizationAtlasRouteSummary } from '../service-localization-atlas.mjs';

export function createLocalizationAtlasRegistryRoutes(basePath = '/registry/localization-atlas') {
  const snapshot = buildLocalizationAtlasSnapshot();
  return [
    { id: 'localization-atlas.registry.summary', method: 'GET', path: basePath, summary: createLocalizationAtlasRouteSummary(snapshot) },
    { id: 'localization-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

