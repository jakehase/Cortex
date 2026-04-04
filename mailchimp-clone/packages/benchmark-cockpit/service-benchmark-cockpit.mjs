import { createBenchmarkCockpitWorkspace, summarizeBenchmarkCockpitWorkspace, createBenchmarkCockpitNarratives, createBenchmarkCockpitCoverageGrid } from './domain-benchmark-cockpit.mjs';
import { createBenchmarkCockpitPolicies, validateBenchmarkCockpitPolicies, summarizeBenchmarkCockpitPolicies, createBenchmarkCockpitEscalationDeck } from './policies-benchmark-cockpit.mjs';
import { createBenchmarkCockpitAnalyticsTimeline, createBenchmarkCockpitForecastEnvelope, createBenchmarkCockpitExceptionLedger, summarizeBenchmarkCockpitAnalytics } from './analytics-benchmark-cockpit.mjs';
import { createBenchmarkCockpitOperationsBoard, createBenchmarkCockpitShiftChecklist, createBenchmarkCockpitIncidentDeck } from './operations-benchmark-cockpit.mjs';
import { createBenchmarkCockpitReportCards, createBenchmarkCockpitReviewPackets, summarizeBenchmarkCockpitReporting } from './reporting-benchmark-cockpit.mjs';
import { createBenchmarkCockpitAuditTrail, createBenchmarkCockpitEvidenceManifest, createBenchmarkCockpitReadinessAttestation } from './audit-benchmark-cockpit.mjs';
import { createBenchmarkCockpitPlaybooks, createBenchmarkCockpitDecisionDeck, createBenchmarkCockpitEscalationMoments } from './playbooks-benchmark-cockpit.mjs';

export function buildBenchmarkCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkCockpitWorkspace(workspaceName);
  const policies = createBenchmarkCockpitPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkCockpitWorkspace(workspace),
    narratives: createBenchmarkCockpitNarratives(workspace),
    coverage: createBenchmarkCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkCockpitPolicies(policies),
    validation: validateBenchmarkCockpitPolicies(policies),
    escalationDeck: createBenchmarkCockpitEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkCockpitAnalyticsTimeline(),
      forecast: createBenchmarkCockpitForecastEnvelope(),
      exceptions: createBenchmarkCockpitExceptionLedger(),
      summary: summarizeBenchmarkCockpitAnalytics()
    },
    operations: {
      board: createBenchmarkCockpitOperationsBoard(),
      checklist: createBenchmarkCockpitShiftChecklist(),
      incidents: createBenchmarkCockpitIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkCockpitReportCards(),
      packets: createBenchmarkCockpitReviewPackets(),
      summary: summarizeBenchmarkCockpitReporting()
    },
    audit: {
      trail: createBenchmarkCockpitAuditTrail(),
      manifest: createBenchmarkCockpitEvidenceManifest(),
      attestation: createBenchmarkCockpitReadinessAttestation()
    },
    playbooks: createBenchmarkCockpitPlaybooks(),
    decisions: createBenchmarkCockpitDecisionDeck(),
    escalationMoments: createBenchmarkCockpitEscalationMoments()
  };
}

export function createBenchmarkCockpitReadinessBoard(snapshot = buildBenchmarkCockpitSnapshot()) {
  return [
    { id: 'benchmark-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkCockpitApiDocument(snapshot = buildBenchmarkCockpitSnapshot()) {
  return {
    id: 'benchmark-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-cockpit/overview' },
      { method: 'GET', path: '/api/benchmark-cockpit/reporting' },
      { method: 'POST', path: '/api/benchmark-cockpit/validate' },
      { method: 'GET', path: '/api/benchmark-cockpit/audit' }
    ],
    readiness: createBenchmarkCockpitReadinessBoard(snapshot)
  };
}

export function createBenchmarkCockpitRouteSummary(snapshot = buildBenchmarkCockpitSnapshot()) {
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

