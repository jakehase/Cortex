import { buildLocalizationWorkbenchSnapshot, createLocalizationWorkbenchRouteSummary } from '../service-localization-workbench.mjs';

export function createLocalizationWorkbenchRegistryRoutes(basePath = '/registry/localization-workbench') {
  const snapshot = buildLocalizationWorkbenchSnapshot();
  return [
    { id: 'localization-workbench.registry.summary', method: 'GET', path: basePath, summary: createLocalizationWorkbenchRouteSummary(snapshot) },
    { id: 'localization-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

