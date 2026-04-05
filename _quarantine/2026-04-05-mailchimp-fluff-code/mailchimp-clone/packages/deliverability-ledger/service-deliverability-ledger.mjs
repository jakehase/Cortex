import { createDeliverabilityLedgerWorkspace, summarizeDeliverabilityLedgerWorkspace, createDeliverabilityLedgerNarratives, createDeliverabilityLedgerCoverageGrid } from './domain-deliverability-ledger.mjs';
import { createDeliverabilityLedgerPolicies, validateDeliverabilityLedgerPolicies, summarizeDeliverabilityLedgerPolicies, createDeliverabilityLedgerEscalationDeck } from './policies-deliverability-ledger.mjs';
import { createDeliverabilityLedgerAnalyticsTimeline, createDeliverabilityLedgerForecastEnvelope, createDeliverabilityLedgerExceptionLedger, summarizeDeliverabilityLedgerAnalytics } from './analytics-deliverability-ledger.mjs';
import { createDeliverabilityLedgerOperationsBoard, createDeliverabilityLedgerShiftChecklist, createDeliverabilityLedgerIncidentDeck } from './operations-deliverability-ledger.mjs';
import { createDeliverabilityLedgerReportCards, createDeliverabilityLedgerReviewPackets, summarizeDeliverabilityLedgerReporting } from './reporting-deliverability-ledger.mjs';
import { createDeliverabilityLedgerAuditTrail, createDeliverabilityLedgerEvidenceManifest, createDeliverabilityLedgerReadinessAttestation } from './audit-deliverability-ledger.mjs';
import { createDeliverabilityLedgerPlaybooks, createDeliverabilityLedgerDecisionDeck, createDeliverabilityLedgerEscalationMoments } from './playbooks-deliverability-ledger.mjs';

export function buildDeliverabilityLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityLedgerWorkspace(workspaceName);
  const policies = createDeliverabilityLedgerPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityLedgerWorkspace(workspace),
    narratives: createDeliverabilityLedgerNarratives(workspace),
    coverage: createDeliverabilityLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityLedgerPolicies(policies),
    validation: validateDeliverabilityLedgerPolicies(policies),
    escalationDeck: createDeliverabilityLedgerEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityLedgerAnalyticsTimeline(),
      forecast: createDeliverabilityLedgerForecastEnvelope(),
      exceptions: createDeliverabilityLedgerExceptionLedger(),
      summary: summarizeDeliverabilityLedgerAnalytics()
    },
    operations: {
      board: createDeliverabilityLedgerOperationsBoard(),
      checklist: createDeliverabilityLedgerShiftChecklist(),
      incidents: createDeliverabilityLedgerIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityLedgerReportCards(),
      packets: createDeliverabilityLedgerReviewPackets(),
      summary: summarizeDeliverabilityLedgerReporting()
    },
    audit: {
      trail: createDeliverabilityLedgerAuditTrail(),
      manifest: createDeliverabilityLedgerEvidenceManifest(),
      attestation: createDeliverabilityLedgerReadinessAttestation()
    },
    playbooks: createDeliverabilityLedgerPlaybooks(),
    decisions: createDeliverabilityLedgerDecisionDeck(),
    escalationMoments: createDeliverabilityLedgerEscalationMoments()
  };
}

export function createDeliverabilityLedgerReadinessBoard(snapshot = buildDeliverabilityLedgerSnapshot()) {
  return [
    { id: 'deliverability-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityLedgerApiDocument(snapshot = buildDeliverabilityLedgerSnapshot()) {
  return {
    id: 'deliverability-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-ledger/overview' },
      { method: 'GET', path: '/api/deliverability-ledger/reporting' },
      { method: 'POST', path: '/api/deliverability-ledger/validate' },
      { method: 'GET', path: '/api/deliverability-ledger/audit' }
    ],
    readiness: createDeliverabilityLedgerReadinessBoard(snapshot)
  };
}

export function createDeliverabilityLedgerRouteSummary(snapshot = buildDeliverabilityLedgerSnapshot()) {
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

