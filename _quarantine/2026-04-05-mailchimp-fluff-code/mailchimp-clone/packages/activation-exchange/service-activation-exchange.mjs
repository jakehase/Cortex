import { createActivationExchangeWorkspace, summarizeActivationExchangeWorkspace, createActivationExchangeNarratives, createActivationExchangeCoverageGrid } from './domain-activation-exchange.mjs';
import { createActivationExchangePolicies, validateActivationExchangePolicies, summarizeActivationExchangePolicies, createActivationExchangeEscalationDeck } from './policies-activation-exchange.mjs';
import { createActivationExchangeAnalyticsTimeline, createActivationExchangeForecastEnvelope, createActivationExchangeExceptionLedger, summarizeActivationExchangeAnalytics } from './analytics-activation-exchange.mjs';
import { createActivationExchangeOperationsBoard, createActivationExchangeShiftChecklist, createActivationExchangeIncidentDeck } from './operations-activation-exchange.mjs';
import { createActivationExchangeReportCards, createActivationExchangeReviewPackets, summarizeActivationExchangeReporting } from './reporting-activation-exchange.mjs';
import { createActivationExchangeAuditTrail, createActivationExchangeEvidenceManifest, createActivationExchangeReadinessAttestation } from './audit-activation-exchange.mjs';
import { createActivationExchangePlaybooks, createActivationExchangeDecisionDeck, createActivationExchangeEscalationMoments } from './playbooks-activation-exchange.mjs';

export function buildActivationExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationExchangeWorkspace(workspaceName);
  const policies = createActivationExchangePolicies();
  return {
    workspace,
    summary: summarizeActivationExchangeWorkspace(workspace),
    narratives: createActivationExchangeNarratives(workspace),
    coverage: createActivationExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationExchangePolicies(policies),
    validation: validateActivationExchangePolicies(policies),
    escalationDeck: createActivationExchangeEscalationDeck(policies),
    analytics: {
      timeline: createActivationExchangeAnalyticsTimeline(),
      forecast: createActivationExchangeForecastEnvelope(),
      exceptions: createActivationExchangeExceptionLedger(),
      summary: summarizeActivationExchangeAnalytics()
    },
    operations: {
      board: createActivationExchangeOperationsBoard(),
      checklist: createActivationExchangeShiftChecklist(),
      incidents: createActivationExchangeIncidentDeck()
    },
    reporting: {
      cards: createActivationExchangeReportCards(),
      packets: createActivationExchangeReviewPackets(),
      summary: summarizeActivationExchangeReporting()
    },
    audit: {
      trail: createActivationExchangeAuditTrail(),
      manifest: createActivationExchangeEvidenceManifest(),
      attestation: createActivationExchangeReadinessAttestation()
    },
    playbooks: createActivationExchangePlaybooks(),
    decisions: createActivationExchangeDecisionDeck(),
    escalationMoments: createActivationExchangeEscalationMoments()
  };
}

export function createActivationExchangeReadinessBoard(snapshot = buildActivationExchangeSnapshot()) {
  return [
    { id: 'activation-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationExchangeApiDocument(snapshot = buildActivationExchangeSnapshot()) {
  return {
    id: 'activation-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-exchange/overview' },
      { method: 'GET', path: '/api/activation-exchange/reporting' },
      { method: 'POST', path: '/api/activation-exchange/validate' },
      { method: 'GET', path: '/api/activation-exchange/audit' }
    ],
    readiness: createActivationExchangeReadinessBoard(snapshot)
  };
}

export function createActivationExchangeRouteSummary(snapshot = buildActivationExchangeSnapshot()) {
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

