import { createCommerceLedgerWorkspace, summarizeCommerceLedgerWorkspace, createCommerceLedgerNarratives, createCommerceLedgerCoverageGrid } from './domain-commerce-ledger.mjs';
import { createCommerceLedgerPolicies, validateCommerceLedgerPolicies, summarizeCommerceLedgerPolicies, createCommerceLedgerEscalationDeck } from './policies-commerce-ledger.mjs';
import { createCommerceLedgerAnalyticsTimeline, createCommerceLedgerForecastEnvelope, createCommerceLedgerExceptionLedger, summarizeCommerceLedgerAnalytics } from './analytics-commerce-ledger.mjs';
import { createCommerceLedgerOperationsBoard, createCommerceLedgerShiftChecklist, createCommerceLedgerIncidentDeck } from './operations-commerce-ledger.mjs';
import { createCommerceLedgerReportCards, createCommerceLedgerReviewPackets, summarizeCommerceLedgerReporting } from './reporting-commerce-ledger.mjs';
import { createCommerceLedgerAuditTrail, createCommerceLedgerEvidenceManifest, createCommerceLedgerReadinessAttestation } from './audit-commerce-ledger.mjs';
import { createCommerceLedgerPlaybooks, createCommerceLedgerDecisionDeck, createCommerceLedgerEscalationMoments } from './playbooks-commerce-ledger.mjs';

export function buildCommerceLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceLedgerWorkspace(workspaceName);
  const policies = createCommerceLedgerPolicies();
  return {
    workspace,
    summary: summarizeCommerceLedgerWorkspace(workspace),
    narratives: createCommerceLedgerNarratives(workspace),
    coverage: createCommerceLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceLedgerPolicies(policies),
    validation: validateCommerceLedgerPolicies(policies),
    escalationDeck: createCommerceLedgerEscalationDeck(policies),
    analytics: {
      timeline: createCommerceLedgerAnalyticsTimeline(),
      forecast: createCommerceLedgerForecastEnvelope(),
      exceptions: createCommerceLedgerExceptionLedger(),
      summary: summarizeCommerceLedgerAnalytics()
    },
    operations: {
      board: createCommerceLedgerOperationsBoard(),
      checklist: createCommerceLedgerShiftChecklist(),
      incidents: createCommerceLedgerIncidentDeck()
    },
    reporting: {
      cards: createCommerceLedgerReportCards(),
      packets: createCommerceLedgerReviewPackets(),
      summary: summarizeCommerceLedgerReporting()
    },
    audit: {
      trail: createCommerceLedgerAuditTrail(),
      manifest: createCommerceLedgerEvidenceManifest(),
      attestation: createCommerceLedgerReadinessAttestation()
    },
    playbooks: createCommerceLedgerPlaybooks(),
    decisions: createCommerceLedgerDecisionDeck(),
    escalationMoments: createCommerceLedgerEscalationMoments()
  };
}

export function createCommerceLedgerReadinessBoard(snapshot = buildCommerceLedgerSnapshot()) {
  return [
    { id: 'commerce-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceLedgerApiDocument(snapshot = buildCommerceLedgerSnapshot()) {
  return {
    id: 'commerce-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-ledger/overview' },
      { method: 'GET', path: '/api/commerce-ledger/reporting' },
      { method: 'POST', path: '/api/commerce-ledger/validate' },
      { method: 'GET', path: '/api/commerce-ledger/audit' }
    ],
    readiness: createCommerceLedgerReadinessBoard(snapshot)
  };
}

export function createCommerceLedgerRouteSummary(snapshot = buildCommerceLedgerSnapshot()) {
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

