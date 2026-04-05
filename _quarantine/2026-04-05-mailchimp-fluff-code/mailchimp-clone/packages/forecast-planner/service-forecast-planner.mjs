import { createForecastPlannerWorkspace, summarizeForecastPlanner, createForecastPlannerNarratives } from './domain-forecast-planner.mjs';
import { createForecastPlannerPolicies, validateForecastPlannerPolicies, policySummaryForecastPlanner } from './domain-forecast-planner-policies.mjs';

export function buildForecastPlannerSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createForecastPlannerWorkspace(workspaceName);
  const policies = createForecastPlannerPolicies();
  return {
    workspace,
    summary: summarizeForecastPlanner(workspace),
    narratives: createForecastPlannerNarratives(workspace),
    policies,
    policySummary: policySummaryForecastPlanner(policies),
    validation: validateForecastPlannerPolicies(policies)
  };
}

export function createForecastPlannerChecklist(snapshot = buildForecastPlannerSnapshot()) {
  return [
    { id: 'forecast-planner-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'forecast-planner-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'forecast-planner-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createForecastPlannerApiDocument(snapshot = buildForecastPlannerSnapshot()) {
  return {
    id: 'forecast-planner-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/forecast-planner/overview' },
      { method: 'POST', path: '/api/forecast-planner/validate' },
      { method: 'GET', path: '/api/forecast-planner/policies' }
    ],
    checklist: createForecastPlannerChecklist(snapshot)
  };
}
