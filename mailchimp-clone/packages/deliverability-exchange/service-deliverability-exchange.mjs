import { createDeliverabilityExchangeWorkspace, summarizeDeliverabilityExchangeWorkspace, createDeliverabilityExchangeNarratives, createDeliverabilityExchangeCoverageGrid } from './domain-deliverability-exchange.mjs';
import { createDeliverabilityExchangePolicies, validateDeliverabilityExchangePolicies, summarizeDeliverabilityExchangePolicies, createDeliverabilityExchangeEscalationDeck } from './policies-deliverability-exchange.mjs';
import { createDeliverabilityExchangeAnalyticsTimeline, createDeliverabilityExchangeForecastEnvelope, createDeliverabilityExchangeExceptionLedger, summarizeDeliverabilityExchangeAnalytics } from './analytics-deliverability-exchange.mjs';
import { createDeliverabilityExchangeOperationsBoard, createDeliverabilityExchangeShiftChecklist, createDeliverabilityExchangeIncidentDeck } from './operations-deliverability-exchange.mjs';
import { createDeliverabilityExchangeReportCards, createDeliverabilityExchangeReviewPackets, summarizeDeliverabilityExchangeReporting } from './reporting-deliverability-exchange.mjs';
import { createDeliverabilityExchangeAuditTrail, createDeliverabilityExchangeEvidenceManifest, createDeliverabilityExchangeReadinessAttestation } from './audit-deliverability-exchange.mjs';
import { createDeliverabilityExchangePlaybooks, createDeliverabilityExchangeDecisionDeck, createDeliverabilityExchangeEscalationMoments } from './playbooks-deliverability-exchange.mjs';

export function buildDeliverabilityExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityExchangeWorkspace(workspaceName);
  const policies = createDeliverabilityExchangePolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityExchangeWorkspace(workspace),
    narratives: createDeliverabilityExchangeNarratives(workspace),
    coverage: createDeliverabilityExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityExchangePolicies(policies),
    validation: validateDeliverabilityExchangePolicies(policies),
    escalationDeck: createDeliverabilityExchangeEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityExchangeAnalyticsTimeline(),
      forecast: createDeliverabilityExchangeForecastEnvelope(),
      exceptions: createDeliverabilityExchangeExceptionLedger(),
      summary: summarizeDeliverabilityExchangeAnalytics()
    },
    operations: {
      board: createDeliverabilityExchangeOperationsBoard(),
      checklist: createDeliverabilityExchangeShiftChecklist(),
      incidents: createDeliverabilityExchangeIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityExchangeReportCards(),
      packets: createDeliverabilityExchangeReviewPackets(),
      summary: summarizeDeliverabilityExchangeReporting()
    },
    audit: {
      trail: createDeliverabilityExchangeAuditTrail(),
      manifest: createDeliverabilityExchangeEvidenceManifest(),
      attestation: createDeliverabilityExchangeReadinessAttestation()
    },
    playbooks: createDeliverabilityExchangePlaybooks(),
    decisions: createDeliverabilityExchangeDecisionDeck(),
    escalationMoments: createDeliverabilityExchangeEscalationMoments()
  };
}

export function createDeliverabilityExchangeReadinessBoard(snapshot = buildDeliverabilityExchangeSnapshot()) {
  return [
    { id: 'deliverability-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityExchangeApiDocument(snapshot = buildDeliverabilityExchangeSnapshot()) {
  return {
    id: 'deliverability-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-exchange/overview' },
      { method: 'GET', path: '/api/deliverability-exchange/reporting' },
      { method: 'POST', path: '/api/deliverability-exchange/validate' },
      { method: 'GET', path: '/api/deliverability-exchange/audit' }
    ],
    readiness: createDeliverabilityExchangeReadinessBoard(snapshot)
  };
}

export function createDeliverabilityExchangeRouteSummary(snapshot = buildDeliverabilityExchangeSnapshot()) {
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

