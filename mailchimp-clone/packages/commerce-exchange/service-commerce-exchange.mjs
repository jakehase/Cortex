import { createCommerceExchangeWorkspace, summarizeCommerceExchangeWorkspace, createCommerceExchangeNarratives, createCommerceExchangeCoverageGrid } from './domain-commerce-exchange.mjs';
import { createCommerceExchangePolicies, validateCommerceExchangePolicies, summarizeCommerceExchangePolicies, createCommerceExchangeEscalationDeck } from './policies-commerce-exchange.mjs';
import { createCommerceExchangeAnalyticsTimeline, createCommerceExchangeForecastEnvelope, createCommerceExchangeExceptionLedger, summarizeCommerceExchangeAnalytics } from './analytics-commerce-exchange.mjs';
import { createCommerceExchangeOperationsBoard, createCommerceExchangeShiftChecklist, createCommerceExchangeIncidentDeck } from './operations-commerce-exchange.mjs';
import { createCommerceExchangeReportCards, createCommerceExchangeReviewPackets, summarizeCommerceExchangeReporting } from './reporting-commerce-exchange.mjs';
import { createCommerceExchangeAuditTrail, createCommerceExchangeEvidenceManifest, createCommerceExchangeReadinessAttestation } from './audit-commerce-exchange.mjs';
import { createCommerceExchangePlaybooks, createCommerceExchangeDecisionDeck, createCommerceExchangeEscalationMoments } from './playbooks-commerce-exchange.mjs';

export function buildCommerceExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceExchangeWorkspace(workspaceName);
  const policies = createCommerceExchangePolicies();
  return {
    workspace,
    summary: summarizeCommerceExchangeWorkspace(workspace),
    narratives: createCommerceExchangeNarratives(workspace),
    coverage: createCommerceExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceExchangePolicies(policies),
    validation: validateCommerceExchangePolicies(policies),
    escalationDeck: createCommerceExchangeEscalationDeck(policies),
    analytics: {
      timeline: createCommerceExchangeAnalyticsTimeline(),
      forecast: createCommerceExchangeForecastEnvelope(),
      exceptions: createCommerceExchangeExceptionLedger(),
      summary: summarizeCommerceExchangeAnalytics()
    },
    operations: {
      board: createCommerceExchangeOperationsBoard(),
      checklist: createCommerceExchangeShiftChecklist(),
      incidents: createCommerceExchangeIncidentDeck()
    },
    reporting: {
      cards: createCommerceExchangeReportCards(),
      packets: createCommerceExchangeReviewPackets(),
      summary: summarizeCommerceExchangeReporting()
    },
    audit: {
      trail: createCommerceExchangeAuditTrail(),
      manifest: createCommerceExchangeEvidenceManifest(),
      attestation: createCommerceExchangeReadinessAttestation()
    },
    playbooks: createCommerceExchangePlaybooks(),
    decisions: createCommerceExchangeDecisionDeck(),
    escalationMoments: createCommerceExchangeEscalationMoments()
  };
}

export function createCommerceExchangeReadinessBoard(snapshot = buildCommerceExchangeSnapshot()) {
  return [
    { id: 'commerce-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceExchangeApiDocument(snapshot = buildCommerceExchangeSnapshot()) {
  return {
    id: 'commerce-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-exchange/overview' },
      { method: 'GET', path: '/api/commerce-exchange/reporting' },
      { method: 'POST', path: '/api/commerce-exchange/validate' },
      { method: 'GET', path: '/api/commerce-exchange/audit' }
    ],
    readiness: createCommerceExchangeReadinessBoard(snapshot)
  };
}

export function createCommerceExchangeRouteSummary(snapshot = buildCommerceExchangeSnapshot()) {
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

