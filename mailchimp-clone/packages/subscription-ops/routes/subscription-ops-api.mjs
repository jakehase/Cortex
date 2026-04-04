import { buildSubscriptionOpsSnapshot, createSubscriptionOpsApiDocument } from '../service-subscription-ops.mjs';

export function createSubscriptionOpsApiRoutes(basePath = '/api/subscription-ops') {
  const snapshot = buildSubscriptionOpsSnapshot();
  return [
    { id: 'subscription-ops.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'subscription-ops.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'subscription-ops.api.document', method: 'GET', path: basePath + '/document', document: createSubscriptionOpsApiDocument(snapshot) }
  ];
}
