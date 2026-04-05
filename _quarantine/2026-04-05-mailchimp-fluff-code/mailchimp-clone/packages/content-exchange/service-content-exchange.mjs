import { createContentExchangeWorkspace, summarizeContentExchangeWorkspace, createContentExchangeNarratives, createContentExchangeCoverageGrid } from './domain-content-exchange.mjs';
import { createContentExchangePolicies, validateContentExchangePolicies, summarizeContentExchangePolicies, createContentExchangeEscalationDeck } from './policies-content-exchange.mjs';
import { createContentExchangeAnalyticsTimeline, createContentExchangeForecastEnvelope, createContentExchangeExceptionLedger, summarizeContentExchangeAnalytics } from './analytics-content-exchange.mjs';
import { createContentExchangeOperationsBoard, createContentExchangeShiftChecklist, createContentExchangeIncidentDeck } from './operations-content-exchange.mjs';
import { createContentExchangeReportCards, createContentExchangeReviewPackets, summarizeContentExchangeReporting } from './reporting-content-exchange.mjs';
import { createContentExchangeAuditTrail, createContentExchangeEvidenceManifest, createContentExchangeReadinessAttestation } from './audit-content-exchange.mjs';
import { createContentExchangePlaybooks, createContentExchangeDecisionDeck, createContentExchangeEscalationMoments } from './playbooks-content-exchange.mjs';

export function buildContentExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentExchangeWorkspace(workspaceName);
  const policies = createContentExchangePolicies();
  return {
    workspace,
    summary: summarizeContentExchangeWorkspace(workspace),
    narratives: createContentExchangeNarratives(workspace),
    coverage: createContentExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentExchangePolicies(policies),
    validation: validateContentExchangePolicies(policies),
    escalationDeck: createContentExchangeEscalationDeck(policies),
    analytics: {
      timeline: createContentExchangeAnalyticsTimeline(),
      forecast: createContentExchangeForecastEnvelope(),
      exceptions: createContentExchangeExceptionLedger(),
      summary: summarizeContentExchangeAnalytics()
    },
    operations: {
      board: createContentExchangeOperationsBoard(),
      checklist: createContentExchangeShiftChecklist(),
      incidents: createContentExchangeIncidentDeck()
    },
    reporting: {
      cards: createContentExchangeReportCards(),
      packets: createContentExchangeReviewPackets(),
      summary: summarizeContentExchangeReporting()
    },
    audit: {
      trail: createContentExchangeAuditTrail(),
      manifest: createContentExchangeEvidenceManifest(),
      attestation: createContentExchangeReadinessAttestation()
    },
    playbooks: createContentExchangePlaybooks(),
    decisions: createContentExchangeDecisionDeck(),
    escalationMoments: createContentExchangeEscalationMoments()
  };
}

export function createContentExchangeReadinessBoard(snapshot = buildContentExchangeSnapshot()) {
  return [
    { id: 'content-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentExchangeApiDocument(snapshot = buildContentExchangeSnapshot()) {
  return {
    id: 'content-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-exchange/overview' },
      { method: 'GET', path: '/api/content-exchange/reporting' },
      { method: 'POST', path: '/api/content-exchange/validate' },
      { method: 'GET', path: '/api/content-exchange/audit' }
    ],
    readiness: createContentExchangeReadinessBoard(snapshot)
  };
}

export function createContentExchangeRouteSummary(snapshot = buildContentExchangeSnapshot()) {
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

