import { createAutomationLedgerWorkspace, summarizeAutomationLedgerWorkspace, createAutomationLedgerNarratives, createAutomationLedgerCoverageGrid } from './domain-automation-ledger.mjs';
import { createAutomationLedgerPolicies, validateAutomationLedgerPolicies, summarizeAutomationLedgerPolicies, createAutomationLedgerEscalationDeck } from './policies-automation-ledger.mjs';
import { createAutomationLedgerAnalyticsTimeline, createAutomationLedgerForecastEnvelope, createAutomationLedgerExceptionLedger, summarizeAutomationLedgerAnalytics } from './analytics-automation-ledger.mjs';
import { createAutomationLedgerOperationsBoard, createAutomationLedgerShiftChecklist, createAutomationLedgerIncidentDeck } from './operations-automation-ledger.mjs';
import { createAutomationLedgerReportCards, createAutomationLedgerReviewPackets, summarizeAutomationLedgerReporting } from './reporting-automation-ledger.mjs';
import { createAutomationLedgerAuditTrail, createAutomationLedgerEvidenceManifest, createAutomationLedgerReadinessAttestation } from './audit-automation-ledger.mjs';
import { createAutomationLedgerPlaybooks, createAutomationLedgerDecisionDeck, createAutomationLedgerEscalationMoments } from './playbooks-automation-ledger.mjs';

export function buildAutomationLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationLedgerWorkspace(workspaceName);
  const policies = createAutomationLedgerPolicies();
  return {
    workspace,
    summary: summarizeAutomationLedgerWorkspace(workspace),
    narratives: createAutomationLedgerNarratives(workspace),
    coverage: createAutomationLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationLedgerPolicies(policies),
    validation: validateAutomationLedgerPolicies(policies),
    escalationDeck: createAutomationLedgerEscalationDeck(policies),
    analytics: {
      timeline: createAutomationLedgerAnalyticsTimeline(),
      forecast: createAutomationLedgerForecastEnvelope(),
      exceptions: createAutomationLedgerExceptionLedger(),
      summary: summarizeAutomationLedgerAnalytics()
    },
    operations: {
      board: createAutomationLedgerOperationsBoard(),
      checklist: createAutomationLedgerShiftChecklist(),
      incidents: createAutomationLedgerIncidentDeck()
    },
    reporting: {
      cards: createAutomationLedgerReportCards(),
      packets: createAutomationLedgerReviewPackets(),
      summary: summarizeAutomationLedgerReporting()
    },
    audit: {
      trail: createAutomationLedgerAuditTrail(),
      manifest: createAutomationLedgerEvidenceManifest(),
      attestation: createAutomationLedgerReadinessAttestation()
    },
    playbooks: createAutomationLedgerPlaybooks(),
    decisions: createAutomationLedgerDecisionDeck(),
    escalationMoments: createAutomationLedgerEscalationMoments()
  };
}

export function createAutomationLedgerReadinessBoard(snapshot = buildAutomationLedgerSnapshot()) {
  return [
    { id: 'automation-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationLedgerApiDocument(snapshot = buildAutomationLedgerSnapshot()) {
  return {
    id: 'automation-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-ledger/overview' },
      { method: 'GET', path: '/api/automation-ledger/reporting' },
      { method: 'POST', path: '/api/automation-ledger/validate' },
      { method: 'GET', path: '/api/automation-ledger/audit' }
    ],
    readiness: createAutomationLedgerReadinessBoard(snapshot)
  };
}

export function createAutomationLedgerRouteSummary(snapshot = buildAutomationLedgerSnapshot()) {
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

