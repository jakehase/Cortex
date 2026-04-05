import { createBenchmarkStudioWorkspace, summarizeBenchmarkStudio, createBenchmarkStudioNarratives } from './domain-benchmark-studio.mjs';
import { createBenchmarkStudioPolicies, validateBenchmarkStudioPolicies, policySummaryBenchmarkStudio } from './domain-benchmark-studio-policies.mjs';

export function buildBenchmarkStudioSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createBenchmarkStudioWorkspace(workspaceName);
  const policies = createBenchmarkStudioPolicies();
  return { workspace, summary: summarizeBenchmarkStudio(workspace), narratives: createBenchmarkStudioNarratives(workspace), policies, policySummary: policySummaryBenchmarkStudio(policies), validation: validateBenchmarkStudioPolicies(policies) };
}

export function createBenchmarkStudioChecklist(snapshot = buildBenchmarkStudioSnapshot()) {
  return [
    { id: "benchmark-studio-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "benchmark-studio-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "benchmark-studio-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createBenchmarkStudioApiDocument(snapshot = buildBenchmarkStudioSnapshot()) {
  return {
    id: "benchmark-studio-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-studio/overview' },
      { method: 'POST', path: '/api/benchmark-studio/validate' },
      { method: 'GET', path: '/api/benchmark-studio/policies' }
    ],
    checklist: createBenchmarkStudioChecklist(snapshot)
  };
}

