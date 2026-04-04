import { createAudienceWarehouseWorkspace, summarizeAudienceWarehouse, createAudienceWarehouseNarratives } from './domain-audience-warehouse.mjs';
import { createAudienceWarehousePolicies, validateAudienceWarehousePolicies, policySummaryAudienceWarehouse } from './domain-audience-warehouse-policies.mjs';

export function buildAudienceWarehouseSnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createAudienceWarehouseWorkspace(workspaceName);
  const policies = createAudienceWarehousePolicies();
  return { workspace, summary: summarizeAudienceWarehouse(workspace), narratives: createAudienceWarehouseNarratives(workspace), policies, policySummary: policySummaryAudienceWarehouse(policies), validation: validateAudienceWarehousePolicies(policies) };
}

export function createAudienceWarehouseChecklist(snapshot = buildAudienceWarehouseSnapshot()) {
  return [
    { id: 'audience-warehouse-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'audience-warehouse-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'audience-warehouse-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createAudienceWarehouseApiDocument(snapshot = buildAudienceWarehouseSnapshot()) {
  return { id: 'audience-warehouse-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/audience-warehouse/overview' }, { method: 'POST', path: '/api/audience-warehouse/validate' }, { method: 'GET', path: '/api/audience-warehouse/policies' }], checklist: createAudienceWarehouseChecklist(snapshot) };
}
