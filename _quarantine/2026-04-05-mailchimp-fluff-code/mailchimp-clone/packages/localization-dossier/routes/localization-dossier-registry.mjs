import { buildLocalizationDossierSnapshot, createLocalizationDossierRouteSummary } from '../service-localization-dossier.mjs';

export function createLocalizationDossierRegistryRoutes(basePath = '/registry/localization-dossier') {
  const snapshot = buildLocalizationDossierSnapshot();
  return [
    { id: 'localization-dossier.registry.summary', method: 'GET', path: basePath, summary: createLocalizationDossierRouteSummary(snapshot) },
    { id: 'localization-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

