import { createAcquisitionExchangeWorkspace, summarizeAcquisitionExchangeWorkspace, createAcquisitionExchangeNarratives, createAcquisitionExchangeCoverageGrid } from './domain-acquisition-exchange.mjs';
import { createAcquisitionExchangePolicies, validateAcquisitionExchangePolicies, summarizeAcquisitionExchangePolicies, createAcquisitionExchangeEscalationDeck } from './policies-acquisition-exchange.mjs';
import { createAcquisitionExchangeAnalyticsTimeline, createAcquisitionExchangeForecastEnvelope, createAcquisitionExchangeExceptionLedger, summarizeAcquisitionExchangeAnalytics } from './analytics-acquisition-exchange.mjs';
import { createAcquisitionExchangeOperationsBoard, createAcquisitionExchangeShiftChecklist, createAcquisitionExchangeIncidentDeck } from './operations-acquisition-exchange.mjs';
import { createAcquisitionExchangeReportCards, createAcquisitionExchangeReviewPackets, summarizeAcquisitionExchangeReporting } from './reporting-acquisition-exchange.mjs';
import { createAcquisitionExchangeAuditTrail, createAcquisitionExchangeEvidenceManifest, createAcquisitionExchangeReadinessAttestation } from './audit-acquisition-exchange.mjs';
import { createAcquisitionExchangePlaybooks, createAcquisitionExchangeDecisionDeck, createAcquisitionExchangeEscalationMoments } from './playbooks-acquisition-exchange.mjs';

export function buildAcquisitionExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionExchangeWorkspace(workspaceName);
  const policies = createAcquisitionExchangePolicies();
  return {
    workspace,
    summary: summarizeAcquisitionExchangeWorkspace(workspace),
    narratives: createAcquisitionExchangeNarratives(workspace),
    coverage: createAcquisitionExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionExchangePolicies(policies),
    validation: validateAcquisitionExchangePolicies(policies),
    escalationDeck: createAcquisitionExchangeEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionExchangeAnalyticsTimeline(),
      forecast: createAcquisitionExchangeForecastEnvelope(),
      exceptions: createAcquisitionExchangeExceptionLedger(),
      summary: summarizeAcquisitionExchangeAnalytics()
    },
    operations: {
      board: createAcquisitionExchangeOperationsBoard(),
      checklist: createAcquisitionExchangeShiftChecklist(),
      incidents: createAcquisitionExchangeIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionExchangeReportCards(),
      packets: createAcquisitionExchangeReviewPackets(),
      summary: summarizeAcquisitionExchangeReporting()
    },
    audit: {
      trail: createAcquisitionExchangeAuditTrail(),
      manifest: createAcquisitionExchangeEvidenceManifest(),
      attestation: createAcquisitionExchangeReadinessAttestation()
    },
    playbooks: createAcquisitionExchangePlaybooks(),
    decisions: createAcquisitionExchangeDecisionDeck(),
    escalationMoments: createAcquisitionExchangeEscalationMoments()
  };
}

export function createAcquisitionExchangeReadinessBoard(snapshot = buildAcquisitionExchangeSnapshot()) {
  return [
    { id: 'acquisition-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionExchangeApiDocument(snapshot = buildAcquisitionExchangeSnapshot()) {
  return {
    id: 'acquisition-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-exchange/overview' },
      { method: 'GET', path: '/api/acquisition-exchange/reporting' },
      { method: 'POST', path: '/api/acquisition-exchange/validate' },
      { method: 'GET', path: '/api/acquisition-exchange/audit' }
    ],
    readiness: createAcquisitionExchangeReadinessBoard(snapshot)
  };
}

export function createAcquisitionExchangeRouteSummary(snapshot = buildAcquisitionExchangeSnapshot()) {
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

