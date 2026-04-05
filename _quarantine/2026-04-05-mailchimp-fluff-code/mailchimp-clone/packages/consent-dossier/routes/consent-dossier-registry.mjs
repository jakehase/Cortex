import { buildConsentDossierSnapshot, createConsentDossierRouteSummary } from '../service-consent-dossier.mjs';

export function createConsentDossierRegistryRoutes(basePath = '/registry/consent-dossier') {
  const snapshot = buildConsentDossierSnapshot();
  return [
    { id: 'consent-dossier.registry.summary', method: 'GET', path: basePath, summary: createConsentDossierRouteSummary(snapshot) },
    { id: 'consent-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

