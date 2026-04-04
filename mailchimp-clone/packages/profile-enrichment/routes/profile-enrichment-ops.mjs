import { buildProfileEnrichmentSnapshot, createProfileEnrichmentChecklist } from '../service-profile-enrichment.mjs';

export function createProfileEnrichmentOpsRoutes(basePath = '/ops/profile-enrichment') { const snapshot = buildProfileEnrichmentSnapshot(); return [{ id: 'profile-enrichment.ops.health', method: 'GET', path: basePath + '/health', checklist: createProfileEnrichmentChecklist(snapshot) }, { id: 'profile-enrichment.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'profile-enrichment.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

