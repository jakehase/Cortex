import { buildLocalizationCockpitSnapshot, createLocalizationCockpitRouteSummary } from '../service-localization-cockpit.mjs';

export function createLocalizationCockpitRegistryRoutes(basePath = '/registry/localization-cockpit') {
  const snapshot = buildLocalizationCockpitSnapshot();
  return [
    { id: 'localization-cockpit.registry.summary', method: 'GET', path: basePath, summary: createLocalizationCockpitRouteSummary(snapshot) },
    { id: 'localization-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

