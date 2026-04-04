import { createAudienceLedgerWorkspace, summarizeAudienceLedgerWorkspace, createAudienceLedgerNarratives, createAudienceLedgerCoverageGrid } from './domain-audience-ledger.mjs';
import { createAudienceLedgerPolicies, validateAudienceLedgerPolicies, summarizeAudienceLedgerPolicies, createAudienceLedgerEscalationDeck } from './policies-audience-ledger.mjs';
import { createAudienceLedgerAnalyticsTimeline, createAudienceLedgerForecastEnvelope, createAudienceLedgerExceptionLedger, summarizeAudienceLedgerAnalytics } from './analytics-audience-ledger.mjs';
import { createAudienceLedgerOperationsBoard, createAudienceLedgerShiftChecklist, createAudienceLedgerIncidentDeck } from './operations-audience-ledger.mjs';
import { createAudienceLedgerReportCards, createAudienceLedgerReviewPackets, summarizeAudienceLedgerReporting } from './reporting-audience-ledger.mjs';
import { createAudienceLedgerAuditTrail, createAudienceLedgerEvidenceManifest, createAudienceLedgerReadinessAttestation } from './audit-audience-ledger.mjs';
import { createAudienceLedgerPlaybooks, createAudienceLedgerDecisionDeck, createAudienceLedgerEscalationMoments } from './playbooks-audience-ledger.mjs';

export function buildAudienceLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceLedgerWorkspace(workspaceName);
  const policies = createAudienceLedgerPolicies();
  return {
    workspace,
    summary: summarizeAudienceLedgerWorkspace(workspace),
    narratives: createAudienceLedgerNarratives(workspace),
    coverage: createAudienceLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceLedgerPolicies(policies),
    validation: validateAudienceLedgerPolicies(policies),
    escalationDeck: createAudienceLedgerEscalationDeck(policies),
    analytics: {
      timeline: createAudienceLedgerAnalyticsTimeline(),
      forecast: createAudienceLedgerForecastEnvelope(),
      exceptions: createAudienceLedgerExceptionLedger(),
      summary: summarizeAudienceLedgerAnalytics()
    },
    operations: {
      board: createAudienceLedgerOperationsBoard(),
      checklist: createAudienceLedgerShiftChecklist(),
      incidents: createAudienceLedgerIncidentDeck()
    },
    reporting: {
      cards: createAudienceLedgerReportCards(),
      packets: createAudienceLedgerReviewPackets(),
      summary: summarizeAudienceLedgerReporting()
    },
    audit: {
      trail: createAudienceLedgerAuditTrail(),
      manifest: createAudienceLedgerEvidenceManifest(),
      attestation: createAudienceLedgerReadinessAttestation()
    },
    playbooks: createAudienceLedgerPlaybooks(),
    decisions: createAudienceLedgerDecisionDeck(),
    escalationMoments: createAudienceLedgerEscalationMoments()
  };
}

export function createAudienceLedgerReadinessBoard(snapshot = buildAudienceLedgerSnapshot()) {
  return [
    { id: 'audience-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceLedgerApiDocument(snapshot = buildAudienceLedgerSnapshot()) {
  return {
    id: 'audience-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-ledger/overview' },
      { method: 'GET', path: '/api/audience-ledger/reporting' },
      { method: 'POST', path: '/api/audience-ledger/validate' },
      { method: 'GET', path: '/api/audience-ledger/audit' }
    ],
    readiness: createAudienceLedgerReadinessBoard(snapshot)
  };
}

export function createAudienceLedgerRouteSummary(snapshot = buildAudienceLedgerSnapshot()) {
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

