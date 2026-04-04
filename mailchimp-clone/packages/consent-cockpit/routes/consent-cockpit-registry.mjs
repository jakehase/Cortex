import { buildConsentCockpitSnapshot, createConsentCockpitRouteSummary } from '../service-consent-cockpit.mjs';

export function createConsentCockpitRegistryRoutes(basePath = '/registry/consent-cockpit') {
  const snapshot = buildConsentCockpitSnapshot();
  return [
    { id: 'consent-cockpit.registry.summary', method: 'GET', path: basePath, summary: createConsentCockpitRouteSummary(snapshot) },
    { id: 'consent-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

