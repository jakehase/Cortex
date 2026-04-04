import { createLoyaltyExchangeWorkspace, summarizeLoyaltyExchangeWorkspace, createLoyaltyExchangeNarratives, createLoyaltyExchangeCoverageGrid } from './domain-loyalty-exchange.mjs';
import { createLoyaltyExchangePolicies, validateLoyaltyExchangePolicies, summarizeLoyaltyExchangePolicies, createLoyaltyExchangeEscalationDeck } from './policies-loyalty-exchange.mjs';
import { createLoyaltyExchangeAnalyticsTimeline, createLoyaltyExchangeForecastEnvelope, createLoyaltyExchangeExceptionLedger, summarizeLoyaltyExchangeAnalytics } from './analytics-loyalty-exchange.mjs';
import { createLoyaltyExchangeOperationsBoard, createLoyaltyExchangeShiftChecklist, createLoyaltyExchangeIncidentDeck } from './operations-loyalty-exchange.mjs';
import { createLoyaltyExchangeReportCards, createLoyaltyExchangeReviewPackets, summarizeLoyaltyExchangeReporting } from './reporting-loyalty-exchange.mjs';
import { createLoyaltyExchangeAuditTrail, createLoyaltyExchangeEvidenceManifest, createLoyaltyExchangeReadinessAttestation } from './audit-loyalty-exchange.mjs';
import { createLoyaltyExchangePlaybooks, createLoyaltyExchangeDecisionDeck, createLoyaltyExchangeEscalationMoments } from './playbooks-loyalty-exchange.mjs';

export function buildLoyaltyExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyExchangeWorkspace(workspaceName);
  const policies = createLoyaltyExchangePolicies();
  return {
    workspace,
    summary: summarizeLoyaltyExchangeWorkspace(workspace),
    narratives: createLoyaltyExchangeNarratives(workspace),
    coverage: createLoyaltyExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyExchangePolicies(policies),
    validation: validateLoyaltyExchangePolicies(policies),
    escalationDeck: createLoyaltyExchangeEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyExchangeAnalyticsTimeline(),
      forecast: createLoyaltyExchangeForecastEnvelope(),
      exceptions: createLoyaltyExchangeExceptionLedger(),
      summary: summarizeLoyaltyExchangeAnalytics()
    },
    operations: {
      board: createLoyaltyExchangeOperationsBoard(),
      checklist: createLoyaltyExchangeShiftChecklist(),
      incidents: createLoyaltyExchangeIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyExchangeReportCards(),
      packets: createLoyaltyExchangeReviewPackets(),
      summary: summarizeLoyaltyExchangeReporting()
    },
    audit: {
      trail: createLoyaltyExchangeAuditTrail(),
      manifest: createLoyaltyExchangeEvidenceManifest(),
      attestation: createLoyaltyExchangeReadinessAttestation()
    },
    playbooks: createLoyaltyExchangePlaybooks(),
    decisions: createLoyaltyExchangeDecisionDeck(),
    escalationMoments: createLoyaltyExchangeEscalationMoments()
  };
}

export function createLoyaltyExchangeReadinessBoard(snapshot = buildLoyaltyExchangeSnapshot()) {
  return [
    { id: 'loyalty-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyExchangeApiDocument(snapshot = buildLoyaltyExchangeSnapshot()) {
  return {
    id: 'loyalty-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-exchange/overview' },
      { method: 'GET', path: '/api/loyalty-exchange/reporting' },
      { method: 'POST', path: '/api/loyalty-exchange/validate' },
      { method: 'GET', path: '/api/loyalty-exchange/audit' }
    ],
    readiness: createLoyaltyExchangeReadinessBoard(snapshot)
  };
}

export function createLoyaltyExchangeRouteSummary(snapshot = buildLoyaltyExchangeSnapshot()) {
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

