export const SERVICE_BACKEND_CATALOG = Object.freeze([
  { id: 'ai', label: 'AI provider request runtime' },
  { id: 'analytics', label: 'Analytics pipeline runtime' },
  { id: 'integrations', label: 'Integration provider runtime' },
  { id: 'delivery', label: 'Delivery job runtime' },
  { id: 'jobs', label: 'Background jobs runtime' }
]);

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

export function ensureServiceRuntimeCollections(state) {
  state.db ||= {};
  state.db.serviceRequests ||= [];
  state.db.aiModelRuns ||= [];
  state.db.analyticsPipelineRuns ||= [];
  state.db.integrationProviderCursors ||= [];
  state.db.deliveryPipelineRuns ||= [];
  return state.db;
}

export function recordServiceRequest(state, input = {}) {
  const db = ensureServiceRuntimeCollections(state);
  const request = {
    id: input.id || `svc_${Date.now()}_${db.serviceRequests.length}`,
    workspaceId: input.workspaceId || null,
    backend: input.backend || 'unknown',
    operation: input.operation || 'request',
    status: input.status || 'succeeded',
    createdAt: input.createdAt || new Date().toISOString(),
    meta: input.meta || {}
  };
  db.serviceRequests.unshift(request);
  return request;
}

export function serviceRuntimeSummary(state, workspaceId = null) {
  const db = ensureServiceRuntimeCollections(state);
  const scoped = (items = []) => workspaceId ? items.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : items;
  const aiRuns = scoped(db.aiModelRuns);
  const analyticsRuns = scoped(db.analyticsPipelineRuns);
  const integrationCursors = scoped(db.integrationProviderCursors);
  const deliveryRuns = scoped(db.deliveryPipelineRuns);
  const explicitRequests = scoped(db.serviceRequests);
  const derivedSucceeded = aiRuns.length + analyticsRuns.length + integrationCursors.length + deliveryRuns.length;
  const explicitSucceeded = explicitRequests.filter((entry) => entry.status !== 'failed').length;
  const failed = explicitRequests.filter((entry) => entry.status === 'failed').length;
  const succeeded = Math.max(derivedSucceeded, explicitSucceeded);
  return {
    workspaceId,
    serviceBackends: SERVICE_BACKEND_CATALOG.map((entry) => ({ ...entry, status: 'available' })),
    requests: {
      total: succeeded + failed,
      succeeded,
      failed,
      explicit: explicitRequests.length,
      derived: derivedSucceeded
    },
    serviceRequests: {
      total: succeeded + failed,
      succeeded,
      failed,
      explicit: explicitRequests.length,
      derived: derivedSucceeded
    },
    ai: { modelRuns: aiRuns.length },
    integrations: { cursors: integrationCursors.length },
    analytics: { pipelineRuns: analyticsRuns.length },
    delivery: { pipelineRuns: deliveryRuns.length }
  };
}
