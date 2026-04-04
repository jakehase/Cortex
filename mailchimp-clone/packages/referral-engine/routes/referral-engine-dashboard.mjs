import { buildReferralEngineSnapshot } from '../service-referral-engine.mjs';

export function createReferralEngineDashboardRoutes(basePath = '/referral-engine') {
  const snapshot = buildReferralEngineSnapshot();
  return [
    { id: 'referral-engine.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'referral-engine.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'referral-engine.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
