import { createIntegrationsLedgerWorkspace, summarizeIntegrationsLedgerWorkspace, createIntegrationsLedgerNarratives, createIntegrationsLedgerCoverageGrid } from './domain-integrations-ledger.mjs';
import { createIntegrationsLedgerPolicies, validateIntegrationsLedgerPolicies, summarizeIntegrationsLedgerPolicies, createIntegrationsLedgerEscalationDeck } from './policies-integrations-ledger.mjs';
import { createIntegrationsLedgerAnalyticsTimeline, createIntegrationsLedgerForecastEnvelope, createIntegrationsLedgerExceptionLedger, summarizeIntegrationsLedgerAnalytics } from './analytics-integrations-ledger.mjs';
import { createIntegrationsLedgerOperationsBoard, createIntegrationsLedgerShiftChecklist, createIntegrationsLedgerIncidentDeck } from './operations-integrations-ledger.mjs';
import { createIntegrationsLedgerReportCards, createIntegrationsLedgerReviewPackets, summarizeIntegrationsLedgerReporting } from './reporting-integrations-ledger.mjs';
import { createIntegrationsLedgerAuditTrail, createIntegrationsLedgerEvidenceManifest, createIntegrationsLedgerReadinessAttestation } from './audit-integrations-ledger.mjs';
import { createIntegrationsLedgerPlaybooks, createIntegrationsLedgerDecisionDeck, createIntegrationsLedgerEscalationMoments } from './playbooks-integrations-ledger.mjs';

export function buildIntegrationsLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsLedgerWorkspace(workspaceName);
  const policies = createIntegrationsLedgerPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsLedgerWorkspace(workspace),
    narratives: createIntegrationsLedgerNarratives(workspace),
    coverage: createIntegrationsLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsLedgerPolicies(policies),
    validation: validateIntegrationsLedgerPolicies(policies),
    escalationDeck: createIntegrationsLedgerEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsLedgerAnalyticsTimeline(),
      forecast: createIntegrationsLedgerForecastEnvelope(),
      exceptions: createIntegrationsLedgerExceptionLedger(),
      summary: summarizeIntegrationsLedgerAnalytics()
    },
    operations: {
      board: createIntegrationsLedgerOperationsBoard(),
      checklist: createIntegrationsLedgerShiftChecklist(),
      incidents: createIntegrationsLedgerIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsLedgerReportCards(),
      packets: createIntegrationsLedgerReviewPackets(),
      summary: summarizeIntegrationsLedgerReporting()
    },
    audit: {
      trail: createIntegrationsLedgerAuditTrail(),
      manifest: createIntegrationsLedgerEvidenceManifest(),
      attestation: createIntegrationsLedgerReadinessAttestation()
    },
    playbooks: createIntegrationsLedgerPlaybooks(),
    decisions: createIntegrationsLedgerDecisionDeck(),
    escalationMoments: createIntegrationsLedgerEscalationMoments()
  };
}

export function createIntegrationsLedgerReadinessBoard(snapshot = buildIntegrationsLedgerSnapshot()) {
  return [
    { id: 'integrations-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsLedgerApiDocument(snapshot = buildIntegrationsLedgerSnapshot()) {
  return {
    id: 'integrations-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-ledger/overview' },
      { method: 'GET', path: '/api/integrations-ledger/reporting' },
      { method: 'POST', path: '/api/integrations-ledger/validate' },
      { method: 'GET', path: '/api/integrations-ledger/audit' }
    ],
    readiness: createIntegrationsLedgerReadinessBoard(snapshot)
  };
}

export function createIntegrationsLedgerRouteSummary(snapshot = buildIntegrationsLedgerSnapshot()) {
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

