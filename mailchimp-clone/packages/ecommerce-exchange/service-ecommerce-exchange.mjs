import { createEcommerceExchangeWorkspace, summarizeEcommerceExchangeWorkspace, createEcommerceExchangeNarratives, createEcommerceExchangeCoverageGrid } from './domain-ecommerce-exchange.mjs';
import { createEcommerceExchangePolicies, validateEcommerceExchangePolicies, summarizeEcommerceExchangePolicies, createEcommerceExchangeEscalationDeck } from './policies-ecommerce-exchange.mjs';
import { createEcommerceExchangeAnalyticsTimeline, createEcommerceExchangeForecastEnvelope, createEcommerceExchangeExceptionLedger, summarizeEcommerceExchangeAnalytics } from './analytics-ecommerce-exchange.mjs';
import { createEcommerceExchangeOperationsBoard, createEcommerceExchangeShiftChecklist, createEcommerceExchangeIncidentDeck } from './operations-ecommerce-exchange.mjs';
import { createEcommerceExchangeReportCards, createEcommerceExchangeReviewPackets, summarizeEcommerceExchangeReporting } from './reporting-ecommerce-exchange.mjs';
import { createEcommerceExchangeAuditTrail, createEcommerceExchangeEvidenceManifest, createEcommerceExchangeReadinessAttestation } from './audit-ecommerce-exchange.mjs';
import { createEcommerceExchangePlaybooks, createEcommerceExchangeDecisionDeck, createEcommerceExchangeEscalationMoments } from './playbooks-ecommerce-exchange.mjs';

export function buildEcommerceExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceExchangeWorkspace(workspaceName);
  const policies = createEcommerceExchangePolicies();
  return {
    workspace,
    summary: summarizeEcommerceExchangeWorkspace(workspace),
    narratives: createEcommerceExchangeNarratives(workspace),
    coverage: createEcommerceExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceExchangePolicies(policies),
    validation: validateEcommerceExchangePolicies(policies),
    escalationDeck: createEcommerceExchangeEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceExchangeAnalyticsTimeline(),
      forecast: createEcommerceExchangeForecastEnvelope(),
      exceptions: createEcommerceExchangeExceptionLedger(),
      summary: summarizeEcommerceExchangeAnalytics()
    },
    operations: {
      board: createEcommerceExchangeOperationsBoard(),
      checklist: createEcommerceExchangeShiftChecklist(),
      incidents: createEcommerceExchangeIncidentDeck()
    },
    reporting: {
      cards: createEcommerceExchangeReportCards(),
      packets: createEcommerceExchangeReviewPackets(),
      summary: summarizeEcommerceExchangeReporting()
    },
    audit: {
      trail: createEcommerceExchangeAuditTrail(),
      manifest: createEcommerceExchangeEvidenceManifest(),
      attestation: createEcommerceExchangeReadinessAttestation()
    },
    playbooks: createEcommerceExchangePlaybooks(),
    decisions: createEcommerceExchangeDecisionDeck(),
    escalationMoments: createEcommerceExchangeEscalationMoments()
  };
}

export function createEcommerceExchangeReadinessBoard(snapshot = buildEcommerceExchangeSnapshot()) {
  return [
    { id: 'ecommerce-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceExchangeApiDocument(snapshot = buildEcommerceExchangeSnapshot()) {
  return {
    id: 'ecommerce-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-exchange/overview' },
      { method: 'GET', path: '/api/ecommerce-exchange/reporting' },
      { method: 'POST', path: '/api/ecommerce-exchange/validate' },
      { method: 'GET', path: '/api/ecommerce-exchange/audit' }
    ],
    readiness: createEcommerceExchangeReadinessBoard(snapshot)
  };
}

export function createEcommerceExchangeRouteSummary(snapshot = buildEcommerceExchangeSnapshot()) {
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

