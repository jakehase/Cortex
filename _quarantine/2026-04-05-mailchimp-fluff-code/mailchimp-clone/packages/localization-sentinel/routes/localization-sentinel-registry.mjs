import { buildLocalizationSentinelSnapshot, createLocalizationSentinelRouteSummary } from '../service-localization-sentinel.mjs';

export function createLocalizationSentinelRegistryRoutes(basePath = '/registry/localization-sentinel') {
  const snapshot = buildLocalizationSentinelSnapshot();
  return [
    { id: 'localization-sentinel.registry.summary', method: 'GET', path: basePath, summary: createLocalizationSentinelRouteSummary(snapshot) },
    { id: 'localization-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

