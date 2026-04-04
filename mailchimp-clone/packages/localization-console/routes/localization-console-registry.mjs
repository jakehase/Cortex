import { buildLocalizationConsoleSnapshot, createLocalizationConsoleRouteSummary } from '../service-localization-console.mjs';

export function createLocalizationConsoleRegistryRoutes(basePath = '/registry/localization-console') {
  const snapshot = buildLocalizationConsoleSnapshot();
  return [
    { id: 'localization-console.registry.summary', method: 'GET', path: basePath, summary: createLocalizationConsoleRouteSummary(snapshot) },
    { id: 'localization-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

