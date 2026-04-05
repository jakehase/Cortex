import { createBillingExchangeWorkspace, summarizeBillingExchangeWorkspace, createBillingExchangeNarratives, createBillingExchangeCoverageGrid } from './domain-billing-exchange.mjs';
import { createBillingExchangePolicies, validateBillingExchangePolicies, summarizeBillingExchangePolicies, createBillingExchangeEscalationDeck } from './policies-billing-exchange.mjs';
import { createBillingExchangeAnalyticsTimeline, createBillingExchangeForecastEnvelope, createBillingExchangeExceptionLedger, summarizeBillingExchangeAnalytics } from './analytics-billing-exchange.mjs';
import { createBillingExchangeOperationsBoard, createBillingExchangeShiftChecklist, createBillingExchangeIncidentDeck } from './operations-billing-exchange.mjs';
import { createBillingExchangeReportCards, createBillingExchangeReviewPackets, summarizeBillingExchangeReporting } from './reporting-billing-exchange.mjs';
import { createBillingExchangeAuditTrail, createBillingExchangeEvidenceManifest, createBillingExchangeReadinessAttestation } from './audit-billing-exchange.mjs';
import { createBillingExchangePlaybooks, createBillingExchangeDecisionDeck, createBillingExchangeEscalationMoments } from './playbooks-billing-exchange.mjs';

export function buildBillingExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingExchangeWorkspace(workspaceName);
  const policies = createBillingExchangePolicies();
  return {
    workspace,
    summary: summarizeBillingExchangeWorkspace(workspace),
    narratives: createBillingExchangeNarratives(workspace),
    coverage: createBillingExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingExchangePolicies(policies),
    validation: validateBillingExchangePolicies(policies),
    escalationDeck: createBillingExchangeEscalationDeck(policies),
    analytics: {
      timeline: createBillingExchangeAnalyticsTimeline(),
      forecast: createBillingExchangeForecastEnvelope(),
      exceptions: createBillingExchangeExceptionLedger(),
      summary: summarizeBillingExchangeAnalytics()
    },
    operations: {
      board: createBillingExchangeOperationsBoard(),
      checklist: createBillingExchangeShiftChecklist(),
      incidents: createBillingExchangeIncidentDeck()
    },
    reporting: {
      cards: createBillingExchangeReportCards(),
      packets: createBillingExchangeReviewPackets(),
      summary: summarizeBillingExchangeReporting()
    },
    audit: {
      trail: createBillingExchangeAuditTrail(),
      manifest: createBillingExchangeEvidenceManifest(),
      attestation: createBillingExchangeReadinessAttestation()
    },
    playbooks: createBillingExchangePlaybooks(),
    decisions: createBillingExchangeDecisionDeck(),
    escalationMoments: createBillingExchangeEscalationMoments()
  };
}

export function createBillingExchangeReadinessBoard(snapshot = buildBillingExchangeSnapshot()) {
  return [
    { id: 'billing-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingExchangeApiDocument(snapshot = buildBillingExchangeSnapshot()) {
  return {
    id: 'billing-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-exchange/overview' },
      { method: 'GET', path: '/api/billing-exchange/reporting' },
      { method: 'POST', path: '/api/billing-exchange/validate' },
      { method: 'GET', path: '/api/billing-exchange/audit' }
    ],
    readiness: createBillingExchangeReadinessBoard(snapshot)
  };
}

export function createBillingExchangeRouteSummary(snapshot = buildBillingExchangeSnapshot()) {
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

