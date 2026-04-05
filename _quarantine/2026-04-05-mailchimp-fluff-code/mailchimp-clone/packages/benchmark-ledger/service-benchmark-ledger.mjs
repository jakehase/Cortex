import { createBenchmarkLedgerWorkspace, summarizeBenchmarkLedgerWorkspace, createBenchmarkLedgerNarratives, createBenchmarkLedgerCoverageGrid } from './domain-benchmark-ledger.mjs';
import { createBenchmarkLedgerPolicies, validateBenchmarkLedgerPolicies, summarizeBenchmarkLedgerPolicies, createBenchmarkLedgerEscalationDeck } from './policies-benchmark-ledger.mjs';
import { createBenchmarkLedgerAnalyticsTimeline, createBenchmarkLedgerForecastEnvelope, createBenchmarkLedgerExceptionLedger, summarizeBenchmarkLedgerAnalytics } from './analytics-benchmark-ledger.mjs';
import { createBenchmarkLedgerOperationsBoard, createBenchmarkLedgerShiftChecklist, createBenchmarkLedgerIncidentDeck } from './operations-benchmark-ledger.mjs';
import { createBenchmarkLedgerReportCards, createBenchmarkLedgerReviewPackets, summarizeBenchmarkLedgerReporting } from './reporting-benchmark-ledger.mjs';
import { createBenchmarkLedgerAuditTrail, createBenchmarkLedgerEvidenceManifest, createBenchmarkLedgerReadinessAttestation } from './audit-benchmark-ledger.mjs';
import { createBenchmarkLedgerPlaybooks, createBenchmarkLedgerDecisionDeck, createBenchmarkLedgerEscalationMoments } from './playbooks-benchmark-ledger.mjs';

export function buildBenchmarkLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBenchmarkLedgerWorkspace(workspaceName);
  const policies = createBenchmarkLedgerPolicies();
  return {
    workspace,
    summary: summarizeBenchmarkLedgerWorkspace(workspace),
    narratives: createBenchmarkLedgerNarratives(workspace),
    coverage: createBenchmarkLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeBenchmarkLedgerPolicies(policies),
    validation: validateBenchmarkLedgerPolicies(policies),
    escalationDeck: createBenchmarkLedgerEscalationDeck(policies),
    analytics: {
      timeline: createBenchmarkLedgerAnalyticsTimeline(),
      forecast: createBenchmarkLedgerForecastEnvelope(),
      exceptions: createBenchmarkLedgerExceptionLedger(),
      summary: summarizeBenchmarkLedgerAnalytics()
    },
    operations: {
      board: createBenchmarkLedgerOperationsBoard(),
      checklist: createBenchmarkLedgerShiftChecklist(),
      incidents: createBenchmarkLedgerIncidentDeck()
    },
    reporting: {
      cards: createBenchmarkLedgerReportCards(),
      packets: createBenchmarkLedgerReviewPackets(),
      summary: summarizeBenchmarkLedgerReporting()
    },
    audit: {
      trail: createBenchmarkLedgerAuditTrail(),
      manifest: createBenchmarkLedgerEvidenceManifest(),
      attestation: createBenchmarkLedgerReadinessAttestation()
    },
    playbooks: createBenchmarkLedgerPlaybooks(),
    decisions: createBenchmarkLedgerDecisionDeck(),
    escalationMoments: createBenchmarkLedgerEscalationMoments()
  };
}

export function createBenchmarkLedgerReadinessBoard(snapshot = buildBenchmarkLedgerSnapshot()) {
  return [
    { id: 'benchmark-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'benchmark-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'benchmark-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'benchmark-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBenchmarkLedgerApiDocument(snapshot = buildBenchmarkLedgerSnapshot()) {
  return {
    id: 'benchmark-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/benchmark-ledger/overview' },
      { method: 'GET', path: '/api/benchmark-ledger/reporting' },
      { method: 'POST', path: '/api/benchmark-ledger/validate' },
      { method: 'GET', path: '/api/benchmark-ledger/audit' }
    ],
    readiness: createBenchmarkLedgerReadinessBoard(snapshot)
  };
}

export function createBenchmarkLedgerRouteSummary(snapshot = buildBenchmarkLedgerSnapshot()) {
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

