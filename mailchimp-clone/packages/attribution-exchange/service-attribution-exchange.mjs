import { createAttributionExchangeWorkspace, summarizeAttributionExchangeWorkspace, createAttributionExchangeNarratives, createAttributionExchangeCoverageGrid } from './domain-attribution-exchange.mjs';
import { createAttributionExchangePolicies, validateAttributionExchangePolicies, summarizeAttributionExchangePolicies, createAttributionExchangeEscalationDeck } from './policies-attribution-exchange.mjs';
import { createAttributionExchangeAnalyticsTimeline, createAttributionExchangeForecastEnvelope, createAttributionExchangeExceptionLedger, summarizeAttributionExchangeAnalytics } from './analytics-attribution-exchange.mjs';
import { createAttributionExchangeOperationsBoard, createAttributionExchangeShiftChecklist, createAttributionExchangeIncidentDeck } from './operations-attribution-exchange.mjs';
import { createAttributionExchangeReportCards, createAttributionExchangeReviewPackets, summarizeAttributionExchangeReporting } from './reporting-attribution-exchange.mjs';
import { createAttributionExchangeAuditTrail, createAttributionExchangeEvidenceManifest, createAttributionExchangeReadinessAttestation } from './audit-attribution-exchange.mjs';
import { createAttributionExchangePlaybooks, createAttributionExchangeDecisionDeck, createAttributionExchangeEscalationMoments } from './playbooks-attribution-exchange.mjs';

export function buildAttributionExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionExchangeWorkspace(workspaceName);
  const policies = createAttributionExchangePolicies();
  return {
    workspace,
    summary: summarizeAttributionExchangeWorkspace(workspace),
    narratives: createAttributionExchangeNarratives(workspace),
    coverage: createAttributionExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionExchangePolicies(policies),
    validation: validateAttributionExchangePolicies(policies),
    escalationDeck: createAttributionExchangeEscalationDeck(policies),
    analytics: {
      timeline: createAttributionExchangeAnalyticsTimeline(),
      forecast: createAttributionExchangeForecastEnvelope(),
      exceptions: createAttributionExchangeExceptionLedger(),
      summary: summarizeAttributionExchangeAnalytics()
    },
    operations: {
      board: createAttributionExchangeOperationsBoard(),
      checklist: createAttributionExchangeShiftChecklist(),
      incidents: createAttributionExchangeIncidentDeck()
    },
    reporting: {
      cards: createAttributionExchangeReportCards(),
      packets: createAttributionExchangeReviewPackets(),
      summary: summarizeAttributionExchangeReporting()
    },
    audit: {
      trail: createAttributionExchangeAuditTrail(),
      manifest: createAttributionExchangeEvidenceManifest(),
      attestation: createAttributionExchangeReadinessAttestation()
    },
    playbooks: createAttributionExchangePlaybooks(),
    decisions: createAttributionExchangeDecisionDeck(),
    escalationMoments: createAttributionExchangeEscalationMoments()
  };
}

export function createAttributionExchangeReadinessBoard(snapshot = buildAttributionExchangeSnapshot()) {
  return [
    { id: 'attribution-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionExchangeApiDocument(snapshot = buildAttributionExchangeSnapshot()) {
  return {
    id: 'attribution-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-exchange/overview' },
      { method: 'GET', path: '/api/attribution-exchange/reporting' },
      { method: 'POST', path: '/api/attribution-exchange/validate' },
      { method: 'GET', path: '/api/attribution-exchange/audit' }
    ],
    readiness: createAttributionExchangeReadinessBoard(snapshot)
  };
}

export function createAttributionExchangeRouteSummary(snapshot = buildAttributionExchangeSnapshot()) {
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

