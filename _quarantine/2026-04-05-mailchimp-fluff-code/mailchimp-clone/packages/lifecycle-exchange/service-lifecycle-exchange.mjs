import { createLifecycleExchangeWorkspace, summarizeLifecycleExchangeWorkspace, createLifecycleExchangeNarratives, createLifecycleExchangeCoverageGrid } from './domain-lifecycle-exchange.mjs';
import { createLifecycleExchangePolicies, validateLifecycleExchangePolicies, summarizeLifecycleExchangePolicies, createLifecycleExchangeEscalationDeck } from './policies-lifecycle-exchange.mjs';
import { createLifecycleExchangeAnalyticsTimeline, createLifecycleExchangeForecastEnvelope, createLifecycleExchangeExceptionLedger, summarizeLifecycleExchangeAnalytics } from './analytics-lifecycle-exchange.mjs';
import { createLifecycleExchangeOperationsBoard, createLifecycleExchangeShiftChecklist, createLifecycleExchangeIncidentDeck } from './operations-lifecycle-exchange.mjs';
import { createLifecycleExchangeReportCards, createLifecycleExchangeReviewPackets, summarizeLifecycleExchangeReporting } from './reporting-lifecycle-exchange.mjs';
import { createLifecycleExchangeAuditTrail, createLifecycleExchangeEvidenceManifest, createLifecycleExchangeReadinessAttestation } from './audit-lifecycle-exchange.mjs';
import { createLifecycleExchangePlaybooks, createLifecycleExchangeDecisionDeck, createLifecycleExchangeEscalationMoments } from './playbooks-lifecycle-exchange.mjs';

export function buildLifecycleExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleExchangeWorkspace(workspaceName);
  const policies = createLifecycleExchangePolicies();
  return {
    workspace,
    summary: summarizeLifecycleExchangeWorkspace(workspace),
    narratives: createLifecycleExchangeNarratives(workspace),
    coverage: createLifecycleExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleExchangePolicies(policies),
    validation: validateLifecycleExchangePolicies(policies),
    escalationDeck: createLifecycleExchangeEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleExchangeAnalyticsTimeline(),
      forecast: createLifecycleExchangeForecastEnvelope(),
      exceptions: createLifecycleExchangeExceptionLedger(),
      summary: summarizeLifecycleExchangeAnalytics()
    },
    operations: {
      board: createLifecycleExchangeOperationsBoard(),
      checklist: createLifecycleExchangeShiftChecklist(),
      incidents: createLifecycleExchangeIncidentDeck()
    },
    reporting: {
      cards: createLifecycleExchangeReportCards(),
      packets: createLifecycleExchangeReviewPackets(),
      summary: summarizeLifecycleExchangeReporting()
    },
    audit: {
      trail: createLifecycleExchangeAuditTrail(),
      manifest: createLifecycleExchangeEvidenceManifest(),
      attestation: createLifecycleExchangeReadinessAttestation()
    },
    playbooks: createLifecycleExchangePlaybooks(),
    decisions: createLifecycleExchangeDecisionDeck(),
    escalationMoments: createLifecycleExchangeEscalationMoments()
  };
}

export function createLifecycleExchangeReadinessBoard(snapshot = buildLifecycleExchangeSnapshot()) {
  return [
    { id: 'lifecycle-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleExchangeApiDocument(snapshot = buildLifecycleExchangeSnapshot()) {
  return {
    id: 'lifecycle-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-exchange/overview' },
      { method: 'GET', path: '/api/lifecycle-exchange/reporting' },
      { method: 'POST', path: '/api/lifecycle-exchange/validate' },
      { method: 'GET', path: '/api/lifecycle-exchange/audit' }
    ],
    readiness: createLifecycleExchangeReadinessBoard(snapshot)
  };
}

export function createLifecycleExchangeRouteSummary(snapshot = buildLifecycleExchangeSnapshot()) {
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

