import { buildReferralEngineSnapshot, createReferralEngineApiDocument } from '../service-referral-engine.mjs';

export function createReferralEngineApiRoutes(basePath = '/api/referral-engine') {
  const snapshot = buildReferralEngineSnapshot();
  return [
    { id: 'referral-engine.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'referral-engine.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'referral-engine.api.document', method: 'GET', path: basePath + '/document', document: createReferralEngineApiDocument(snapshot) }
  ];
}
