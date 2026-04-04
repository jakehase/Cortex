import { createCollaborationExchangeWorkspace, summarizeCollaborationExchangeWorkspace, createCollaborationExchangeNarratives, createCollaborationExchangeCoverageGrid } from './domain-collaboration-exchange.mjs';
import { createCollaborationExchangePolicies, validateCollaborationExchangePolicies, summarizeCollaborationExchangePolicies, createCollaborationExchangeEscalationDeck } from './policies-collaboration-exchange.mjs';
import { createCollaborationExchangeAnalyticsTimeline, createCollaborationExchangeForecastEnvelope, createCollaborationExchangeExceptionLedger, summarizeCollaborationExchangeAnalytics } from './analytics-collaboration-exchange.mjs';
import { createCollaborationExchangeOperationsBoard, createCollaborationExchangeShiftChecklist, createCollaborationExchangeIncidentDeck } from './operations-collaboration-exchange.mjs';
import { createCollaborationExchangeReportCards, createCollaborationExchangeReviewPackets, summarizeCollaborationExchangeReporting } from './reporting-collaboration-exchange.mjs';
import { createCollaborationExchangeAuditTrail, createCollaborationExchangeEvidenceManifest, createCollaborationExchangeReadinessAttestation } from './audit-collaboration-exchange.mjs';
import { createCollaborationExchangePlaybooks, createCollaborationExchangeDecisionDeck, createCollaborationExchangeEscalationMoments } from './playbooks-collaboration-exchange.mjs';

export function buildCollaborationExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationExchangeWorkspace(workspaceName);
  const policies = createCollaborationExchangePolicies();
  return {
    workspace,
    summary: summarizeCollaborationExchangeWorkspace(workspace),
    narratives: createCollaborationExchangeNarratives(workspace),
    coverage: createCollaborationExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationExchangePolicies(policies),
    validation: validateCollaborationExchangePolicies(policies),
    escalationDeck: createCollaborationExchangeEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationExchangeAnalyticsTimeline(),
      forecast: createCollaborationExchangeForecastEnvelope(),
      exceptions: createCollaborationExchangeExceptionLedger(),
      summary: summarizeCollaborationExchangeAnalytics()
    },
    operations: {
      board: createCollaborationExchangeOperationsBoard(),
      checklist: createCollaborationExchangeShiftChecklist(),
      incidents: createCollaborationExchangeIncidentDeck()
    },
    reporting: {
      cards: createCollaborationExchangeReportCards(),
      packets: createCollaborationExchangeReviewPackets(),
      summary: summarizeCollaborationExchangeReporting()
    },
    audit: {
      trail: createCollaborationExchangeAuditTrail(),
      manifest: createCollaborationExchangeEvidenceManifest(),
      attestation: createCollaborationExchangeReadinessAttestation()
    },
    playbooks: createCollaborationExchangePlaybooks(),
    decisions: createCollaborationExchangeDecisionDeck(),
    escalationMoments: createCollaborationExchangeEscalationMoments()
  };
}

export function createCollaborationExchangeReadinessBoard(snapshot = buildCollaborationExchangeSnapshot()) {
  return [
    { id: 'collaboration-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationExchangeApiDocument(snapshot = buildCollaborationExchangeSnapshot()) {
  return {
    id: 'collaboration-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-exchange/overview' },
      { method: 'GET', path: '/api/collaboration-exchange/reporting' },
      { method: 'POST', path: '/api/collaboration-exchange/validate' },
      { method: 'GET', path: '/api/collaboration-exchange/audit' }
    ],
    readiness: createCollaborationExchangeReadinessBoard(snapshot)
  };
}

export function createCollaborationExchangeRouteSummary(snapshot = buildCollaborationExchangeSnapshot()) {
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

