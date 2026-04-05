import { createCreativeExchangeWorkspace, summarizeCreativeExchangeWorkspace, createCreativeExchangeNarratives, createCreativeExchangeCoverageGrid } from './domain-creative-exchange.mjs';
import { createCreativeExchangePolicies, validateCreativeExchangePolicies, summarizeCreativeExchangePolicies, createCreativeExchangeEscalationDeck } from './policies-creative-exchange.mjs';
import { createCreativeExchangeAnalyticsTimeline, createCreativeExchangeForecastEnvelope, createCreativeExchangeExceptionLedger, summarizeCreativeExchangeAnalytics } from './analytics-creative-exchange.mjs';
import { createCreativeExchangeOperationsBoard, createCreativeExchangeShiftChecklist, createCreativeExchangeIncidentDeck } from './operations-creative-exchange.mjs';
import { createCreativeExchangeReportCards, createCreativeExchangeReviewPackets, summarizeCreativeExchangeReporting } from './reporting-creative-exchange.mjs';
import { createCreativeExchangeAuditTrail, createCreativeExchangeEvidenceManifest, createCreativeExchangeReadinessAttestation } from './audit-creative-exchange.mjs';
import { createCreativeExchangePlaybooks, createCreativeExchangeDecisionDeck, createCreativeExchangeEscalationMoments } from './playbooks-creative-exchange.mjs';

export function buildCreativeExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeExchangeWorkspace(workspaceName);
  const policies = createCreativeExchangePolicies();
  return {
    workspace,
    summary: summarizeCreativeExchangeWorkspace(workspace),
    narratives: createCreativeExchangeNarratives(workspace),
    coverage: createCreativeExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeExchangePolicies(policies),
    validation: validateCreativeExchangePolicies(policies),
    escalationDeck: createCreativeExchangeEscalationDeck(policies),
    analytics: {
      timeline: createCreativeExchangeAnalyticsTimeline(),
      forecast: createCreativeExchangeForecastEnvelope(),
      exceptions: createCreativeExchangeExceptionLedger(),
      summary: summarizeCreativeExchangeAnalytics()
    },
    operations: {
      board: createCreativeExchangeOperationsBoard(),
      checklist: createCreativeExchangeShiftChecklist(),
      incidents: createCreativeExchangeIncidentDeck()
    },
    reporting: {
      cards: createCreativeExchangeReportCards(),
      packets: createCreativeExchangeReviewPackets(),
      summary: summarizeCreativeExchangeReporting()
    },
    audit: {
      trail: createCreativeExchangeAuditTrail(),
      manifest: createCreativeExchangeEvidenceManifest(),
      attestation: createCreativeExchangeReadinessAttestation()
    },
    playbooks: createCreativeExchangePlaybooks(),
    decisions: createCreativeExchangeDecisionDeck(),
    escalationMoments: createCreativeExchangeEscalationMoments()
  };
}

export function createCreativeExchangeReadinessBoard(snapshot = buildCreativeExchangeSnapshot()) {
  return [
    { id: 'creative-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeExchangeApiDocument(snapshot = buildCreativeExchangeSnapshot()) {
  return {
    id: 'creative-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-exchange/overview' },
      { method: 'GET', path: '/api/creative-exchange/reporting' },
      { method: 'POST', path: '/api/creative-exchange/validate' },
      { method: 'GET', path: '/api/creative-exchange/audit' }
    ],
    readiness: createCreativeExchangeReadinessBoard(snapshot)
  };
}

export function createCreativeExchangeRouteSummary(snapshot = buildCreativeExchangeSnapshot()) {
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

