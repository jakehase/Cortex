import { createBenchmarkFoundryWorkspace, summarizeBenchmarkFoundryWorkspace, createBenchmarkFoundryNarratives, createBenchmarkFoundryCoverageGrid } from './domain-benchmark-foundry.mjs';
import { createBenchmarkFoundryPolicies, validateBenchmarkFoundryPolicies, summarizeBenchmarkFoundryPolicies, createBenchmarkFoundryEscalationDeck } from './policies-benchmark-foundry.mjs';
import { createBenchmarkFoundryAnalyticsTimeline, createBenchmarkFoundryForecastEnvelope, createBenchmarkFoundryExceptionLedger, summarizeBenchmarkFoundryAnalytics } from './analytics-benchmark-foundry.mjs';
import { createBenchmarkFoundryOperationsBoard, createBenchmarkFoundryShiftChecklist, createBenchmarkFoundryIncidentDeck } from './operations-benchmark-foundry.mjs';
import { createBenchmarkFoundryReportCards, createBenchmarkFoundryReviewPackets, summarizeBenchmarkFoundryReporting } from './reporting-benchmark-foundry.mjs';
import { createBenchmarkFoundryAuditTrail, createBenchmarkFoundryEvidenceManifest, createBenchmarkFoundryReadinessAttestation } from './audit-benchmark-foundry.mjs';
import { createBenchmarkFoundryPlaybooks, createBenchmarkFoundryDecisionDeck, createBenchmarkFoundryEscalationMoments } from './playbooks-benchmark-foundry.mjs';

export function buildBenchmarkFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkFoundryWorkspace(workspaceName);
  const policies = createBenchmarkFoundryPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkFoundryWorkspace(workspace),
    narratives: createBenchmarkFoundryNarratives(workspace),
    coverage: createBenchmarkFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkFoundryPolicies(policies),
    validation: validateBenchmarkFoundryPolicies(policies),
    escalationDeck: createBenchmarkFoundryEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkFoundryAnalyticsTimeline(),
      forecast: createBenchmarkFoundryForecastEnvelope(),
      exceptions: createBenchmarkFoundryExceptionLedger(),
      summary: summarizeBenchmarkFoundryAnalytics()
    },
    operations: {
      board: createBenchmarkFoundryOperationsBoard(),
      checklist: createBenchmarkFoundryShiftChecklist(),
      incidents: createBenchmarkFoundryIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkFoundryReportCards(),
      packets: createBenchmarkFoundryReviewPackets(),
      summary: summarizeBenchmarkFoundryReporting()
    },
    audit: {
      trail: createBenchmarkFoundryAuditTrail(),
      manifest: createBenchmarkFoundryEvidenceManifest(),
      attestation: createBenchmarkFoundryReadinessAttestation()
    },
    playbooks: createBenchmarkFoundryPlaybooks(),
    decisions: createBenchmarkFoundryDecisionDeck(),
    escalationMoments: createBenchmarkFoundryEscalationMoments()
  };
}

export function createBenchmarkFoundryReadinessBoard(snapshot = buildBenchmarkFoundrySnapshot()) {
  return [
    { id: 'benchmark-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkFoundryApiDocument(snapshot = buildBenchmarkFoundrySnapshot()) {
  return {
    id: 'benchmark-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-foundry/overview' },
      { method: 'GET', path: '/api/benchmark-foundry/reporting' },
      { method: 'POST', path: '/api/benchmark-foundry/validate' },
      { method: 'GET', path: '/api/benchmark-foundry/audit' }
    ],
    readiness: createBenchmarkFoundryReadinessBoard(snapshot)
  };
}

export function createBenchmarkFoundryRouteSummary(snapshot = buildBenchmarkFoundrySnapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}

