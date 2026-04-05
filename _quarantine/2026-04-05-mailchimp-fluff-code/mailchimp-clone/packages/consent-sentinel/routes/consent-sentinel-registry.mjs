import { buildConsentSentinelSnapshot, createConsentSentinelRouteSummary } from '../service-consent-sentinel.mjs';

export function createConsentSentinelRegistryRoutes(basePath = '/registry/consent-sentinel') {
  const snapshot = buildConsentSentinelSnapshot();
  return [
    { id: 'consent-sentinel.registry.summary', method: 'GET', path: basePath, summary: createConsentSentinelRouteSummary(snapshot) },
    { id: 'consent-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

