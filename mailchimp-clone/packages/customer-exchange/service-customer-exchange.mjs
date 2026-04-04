import { createCustomerExchangeWorkspace, summarizeCustomerExchangeWorkspace, createCustomerExchangeNarratives, createCustomerExchangeCoverageGrid } from './domain-customer-exchange.mjs';
import { createCustomerExchangePolicies, validateCustomerExchangePolicies, summarizeCustomerExchangePolicies, createCustomerExchangeEscalationDeck } from './policies-customer-exchange.mjs';
import { createCustomerExchangeAnalyticsTimeline, createCustomerExchangeForecastEnvelope, createCustomerExchangeExceptionLedger, summarizeCustomerExchangeAnalytics } from './analytics-customer-exchange.mjs';
import { createCustomerExchangeOperationsBoard, createCustomerExchangeShiftChecklist, createCustomerExchangeIncidentDeck } from './operations-customer-exchange.mjs';
import { createCustomerExchangeReportCards, createCustomerExchangeReviewPackets, summarizeCustomerExchangeReporting } from './reporting-customer-exchange.mjs';
import { createCustomerExchangeAuditTrail, createCustomerExchangeEvidenceManifest, createCustomerExchangeReadinessAttestation } from './audit-customer-exchange.mjs';
import { createCustomerExchangePlaybooks, createCustomerExchangeDecisionDeck, createCustomerExchangeEscalationMoments } from './playbooks-customer-exchange.mjs';

export function buildCustomerExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerExchangeWorkspace(workspaceName);
  const policies = createCustomerExchangePolicies();
  return {
    workspace,
    summary: summarizeCustomerExchangeWorkspace(workspace),
    narratives: createCustomerExchangeNarratives(workspace),
    coverage: createCustomerExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerExchangePolicies(policies),
    validation: validateCustomerExchangePolicies(policies),
    escalationDeck: createCustomerExchangeEscalationDeck(policies),
    analytics: {
      timeline: createCustomerExchangeAnalyticsTimeline(),
      forecast: createCustomerExchangeForecastEnvelope(),
      exceptions: createCustomerExchangeExceptionLedger(),
      summary: summarizeCustomerExchangeAnalytics()
    },
    operations: {
      board: createCustomerExchangeOperationsBoard(),
      checklist: createCustomerExchangeShiftChecklist(),
      incidents: createCustomerExchangeIncidentDeck()
    },
    reporting: {
      cards: createCustomerExchangeReportCards(),
      packets: createCustomerExchangeReviewPackets(),
      summary: summarizeCustomerExchangeReporting()
    },
    audit: {
      trail: createCustomerExchangeAuditTrail(),
      manifest: createCustomerExchangeEvidenceManifest(),
      attestation: createCustomerExchangeReadinessAttestation()
    },
    playbooks: createCustomerExchangePlaybooks(),
    decisions: createCustomerExchangeDecisionDeck(),
    escalationMoments: createCustomerExchangeEscalationMoments()
  };
}

export function createCustomerExchangeReadinessBoard(snapshot = buildCustomerExchangeSnapshot()) {
  return [
    { id: 'customer-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerExchangeApiDocument(snapshot = buildCustomerExchangeSnapshot()) {
  return {
    id: 'customer-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-exchange/overview' },
      { method: 'GET', path: '/api/customer-exchange/reporting' },
      { method: 'POST', path: '/api/customer-exchange/validate' },
      { method: 'GET', path: '/api/customer-exchange/audit' }
    ],
    readiness: createCustomerExchangeReadinessBoard(snapshot)
  };
}

export function createCustomerExchangeRouteSummary(snapshot = buildCustomerExchangeSnapshot()) {
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

