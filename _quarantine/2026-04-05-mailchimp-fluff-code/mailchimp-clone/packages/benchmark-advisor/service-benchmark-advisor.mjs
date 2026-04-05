import { createBenchmarkAdvisorWorkspace, summarizeBenchmarkAdvisorWorkspace, createBenchmarkAdvisorNarratives, createBenchmarkAdvisorCoverageGrid } from './domain-benchmark-advisor.mjs';
import { createBenchmarkAdvisorPolicies, validateBenchmarkAdvisorPolicies, summarizeBenchmarkAdvisorPolicies, createBenchmarkAdvisorEscalationDeck } from './policies-benchmark-advisor.mjs';
import { createBenchmarkAdvisorAnalyticsTimeline, createBenchmarkAdvisorForecastEnvelope, createBenchmarkAdvisorExceptionLedger, summarizeBenchmarkAdvisorAnalytics } from './analytics-benchmark-advisor.mjs';
import { createBenchmarkAdvisorOperationsBoard, createBenchmarkAdvisorShiftChecklist, createBenchmarkAdvisorIncidentDeck } from './operations-benchmark-advisor.mjs';
import { createBenchmarkAdvisorReportCards, createBenchmarkAdvisorReviewPackets, summarizeBenchmarkAdvisorReporting } from './reporting-benchmark-advisor.mjs';
import { createBenchmarkAdvisorAuditTrail, createBenchmarkAdvisorEvidenceManifest, createBenchmarkAdvisorReadinessAttestation } from './audit-benchmark-advisor.mjs';
import { createBenchmarkAdvisorPlaybooks, createBenchmarkAdvisorDecisionDeck, createBenchmarkAdvisorEscalationMoments } from './playbooks-benchmark-advisor.mjs';

export function buildBenchmarkAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkAdvisorWorkspace(workspaceName);
  const policies = createBenchmarkAdvisorPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkAdvisorWorkspace(workspace),
    narratives: createBenchmarkAdvisorNarratives(workspace),
    coverage: createBenchmarkAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkAdvisorPolicies(policies),
    validation: validateBenchmarkAdvisorPolicies(policies),
    escalationDeck: createBenchmarkAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkAdvisorAnalyticsTimeline(),
      forecast: createBenchmarkAdvisorForecastEnvelope(),
      exceptions: createBenchmarkAdvisorExceptionLedger(),
      summary: summarizeBenchmarkAdvisorAnalytics()
    },
    operations: {
      board: createBenchmarkAdvisorOperationsBoard(),
      checklist: createBenchmarkAdvisorShiftChecklist(),
      incidents: createBenchmarkAdvisorIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkAdvisorReportCards(),
      packets: createBenchmarkAdvisorReviewPackets(),
      summary: summarizeBenchmarkAdvisorReporting()
    },
    audit: {
      trail: createBenchmarkAdvisorAuditTrail(),
      manifest: createBenchmarkAdvisorEvidenceManifest(),
      attestation: createBenchmarkAdvisorReadinessAttestation()
    },
    playbooks: createBenchmarkAdvisorPlaybooks(),
    decisions: createBenchmarkAdvisorDecisionDeck(),
    escalationMoments: createBenchmarkAdvisorEscalationMoments()
  };
}

export function createBenchmarkAdvisorReadinessBoard(snapshot = buildBenchmarkAdvisorSnapshot()) {
  return [
    { id: 'benchmark-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkAdvisorApiDocument(snapshot = buildBenchmarkAdvisorSnapshot()) {
  return {
    id: 'benchmark-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-advisor/overview' },
      { method: 'GET', path: '/api/benchmark-advisor/reporting' },
      { method: 'POST', path: '/api/benchmark-advisor/validate' },
      { method: 'GET', path: '/api/benchmark-advisor/audit' }
    ],
    readiness: createBenchmarkAdvisorReadinessBoard(snapshot)
  };
}

export function createBenchmarkAdvisorRouteSummary(snapshot = buildBenchmarkAdvisorSnapshot()) {
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

