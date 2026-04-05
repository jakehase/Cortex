import { createAttributionLedgerWorkspace, summarizeAttributionLedgerWorkspace, createAttributionLedgerNarratives, createAttributionLedgerCoverageGrid } from './domain-attribution-ledger.mjs';
import { createAttributionLedgerPolicies, validateAttributionLedgerPolicies, summarizeAttributionLedgerPolicies, createAttributionLedgerEscalationDeck } from './policies-attribution-ledger.mjs';
import { createAttributionLedgerAnalyticsTimeline, createAttributionLedgerForecastEnvelope, createAttributionLedgerExceptionLedger, summarizeAttributionLedgerAnalytics } from './analytics-attribution-ledger.mjs';
import { createAttributionLedgerOperationsBoard, createAttributionLedgerShiftChecklist, createAttributionLedgerIncidentDeck } from './operations-attribution-ledger.mjs';
import { createAttributionLedgerReportCards, createAttributionLedgerReviewPackets, summarizeAttributionLedgerReporting } from './reporting-attribution-ledger.mjs';
import { createAttributionLedgerAuditTrail, createAttributionLedgerEvidenceManifest, createAttributionLedgerReadinessAttestation } from './audit-attribution-ledger.mjs';
import { createAttributionLedgerPlaybooks, createAttributionLedgerDecisionDeck, createAttributionLedgerEscalationMoments } from './playbooks-attribution-ledger.mjs';

export function buildAttributionLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionLedgerWorkspace(workspaceName);
  const policies = createAttributionLedgerPolicies();
  return {
    workspace,
    summary: summarizeAttributionLedgerWorkspace(workspace),
    narratives: createAttributionLedgerNarratives(workspace),
    coverage: createAttributionLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionLedgerPolicies(policies),
    validation: validateAttributionLedgerPolicies(policies),
    escalationDeck: createAttributionLedgerEscalationDeck(policies),
    analytics: {
      timeline: createAttributionLedgerAnalyticsTimeline(),
      forecast: createAttributionLedgerForecastEnvelope(),
      exceptions: createAttributionLedgerExceptionLedger(),
      summary: summarizeAttributionLedgerAnalytics()
    },
    operations: {
      board: createAttributionLedgerOperationsBoard(),
      checklist: createAttributionLedgerShiftChecklist(),
      incidents: createAttributionLedgerIncidentDeck()
    },
    reporting: {
      cards: createAttributionLedgerReportCards(),
      packets: createAttributionLedgerReviewPackets(),
      summary: summarizeAttributionLedgerReporting()
    },
    audit: {
      trail: createAttributionLedgerAuditTrail(),
      manifest: createAttributionLedgerEvidenceManifest(),
      attestation: createAttributionLedgerReadinessAttestation()
    },
    playbooks: createAttributionLedgerPlaybooks(),
    decisions: createAttributionLedgerDecisionDeck(),
    escalationMoments: createAttributionLedgerEscalationMoments()
  };
}

export function createAttributionLedgerReadinessBoard(snapshot = buildAttributionLedgerSnapshot()) {
  return [
    { id: 'attribution-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionLedgerApiDocument(snapshot = buildAttributionLedgerSnapshot()) {
  return {
    id: 'attribution-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-ledger/overview' },
      { method: 'GET', path: '/api/attribution-ledger/reporting' },
      { method: 'POST', path: '/api/attribution-ledger/validate' },
      { method: 'GET', path: '/api/attribution-ledger/audit' }
    ],
    readiness: createAttributionLedgerReadinessBoard(snapshot)
  };
}

export function createAttributionLedgerRouteSummary(snapshot = buildAttributionLedgerSnapshot()) {
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

