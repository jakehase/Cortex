import { createAdvocacyLedgerWorkspace, summarizeAdvocacyLedgerWorkspace, createAdvocacyLedgerNarratives, createAdvocacyLedgerCoverageGrid } from './domain-advocacy-ledger.mjs';
import { createAdvocacyLedgerPolicies, validateAdvocacyLedgerPolicies, summarizeAdvocacyLedgerPolicies, createAdvocacyLedgerEscalationDeck } from './policies-advocacy-ledger.mjs';
import { createAdvocacyLedgerAnalyticsTimeline, createAdvocacyLedgerForecastEnvelope, createAdvocacyLedgerExceptionLedger, summarizeAdvocacyLedgerAnalytics } from './analytics-advocacy-ledger.mjs';
import { createAdvocacyLedgerOperationsBoard, createAdvocacyLedgerShiftChecklist, createAdvocacyLedgerIncidentDeck } from './operations-advocacy-ledger.mjs';
import { createAdvocacyLedgerReportCards, createAdvocacyLedgerReviewPackets, summarizeAdvocacyLedgerReporting } from './reporting-advocacy-ledger.mjs';
import { createAdvocacyLedgerAuditTrail, createAdvocacyLedgerEvidenceManifest, createAdvocacyLedgerReadinessAttestation } from './audit-advocacy-ledger.mjs';
import { createAdvocacyLedgerPlaybooks, createAdvocacyLedgerDecisionDeck, createAdvocacyLedgerEscalationMoments } from './playbooks-advocacy-ledger.mjs';

export function buildAdvocacyLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyLedgerWorkspace(workspaceName);
  const policies = createAdvocacyLedgerPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyLedgerWorkspace(workspace),
    narratives: createAdvocacyLedgerNarratives(workspace),
    coverage: createAdvocacyLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyLedgerPolicies(policies),
    validation: validateAdvocacyLedgerPolicies(policies),
    escalationDeck: createAdvocacyLedgerEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyLedgerAnalyticsTimeline(),
      forecast: createAdvocacyLedgerForecastEnvelope(),
      exceptions: createAdvocacyLedgerExceptionLedger(),
      summary: summarizeAdvocacyLedgerAnalytics()
    },
    operations: {
      board: createAdvocacyLedgerOperationsBoard(),
      checklist: createAdvocacyLedgerShiftChecklist(),
      incidents: createAdvocacyLedgerIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyLedgerReportCards(),
      packets: createAdvocacyLedgerReviewPackets(),
      summary: summarizeAdvocacyLedgerReporting()
    },
    audit: {
      trail: createAdvocacyLedgerAuditTrail(),
      manifest: createAdvocacyLedgerEvidenceManifest(),
      attestation: createAdvocacyLedgerReadinessAttestation()
    },
    playbooks: createAdvocacyLedgerPlaybooks(),
    decisions: createAdvocacyLedgerDecisionDeck(),
    escalationMoments: createAdvocacyLedgerEscalationMoments()
  };
}

export function createAdvocacyLedgerReadinessBoard(snapshot = buildAdvocacyLedgerSnapshot()) {
  return [
    { id: 'advocacy-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyLedgerApiDocument(snapshot = buildAdvocacyLedgerSnapshot()) {
  return {
    id: 'advocacy-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-ledger/overview' },
      { method: 'GET', path: '/api/advocacy-ledger/reporting' },
      { method: 'POST', path: '/api/advocacy-ledger/validate' },
      { method: 'GET', path: '/api/advocacy-ledger/audit' }
    ],
    readiness: createAdvocacyLedgerReadinessBoard(snapshot)
  };
}

export function createAdvocacyLedgerRouteSummary(snapshot = buildAdvocacyLedgerSnapshot()) {
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

