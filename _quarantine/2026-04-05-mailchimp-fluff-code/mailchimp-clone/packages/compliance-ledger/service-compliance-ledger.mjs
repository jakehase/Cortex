import { createComplianceLedgerWorkspace, summarizeComplianceLedgerWorkspace, createComplianceLedgerNarratives, createComplianceLedgerCoverageGrid } from './domain-compliance-ledger.mjs';
import { createComplianceLedgerPolicies, validateComplianceLedgerPolicies, summarizeComplianceLedgerPolicies, createComplianceLedgerEscalationDeck } from './policies-compliance-ledger.mjs';
import { createComplianceLedgerAnalyticsTimeline, createComplianceLedgerForecastEnvelope, createComplianceLedgerExceptionLedger, summarizeComplianceLedgerAnalytics } from './analytics-compliance-ledger.mjs';
import { createComplianceLedgerOperationsBoard, createComplianceLedgerShiftChecklist, createComplianceLedgerIncidentDeck } from './operations-compliance-ledger.mjs';
import { createComplianceLedgerReportCards, createComplianceLedgerReviewPackets, summarizeComplianceLedgerReporting } from './reporting-compliance-ledger.mjs';
import { createComplianceLedgerAuditTrail, createComplianceLedgerEvidenceManifest, createComplianceLedgerReadinessAttestation } from './audit-compliance-ledger.mjs';
import { createComplianceLedgerPlaybooks, createComplianceLedgerDecisionDeck, createComplianceLedgerEscalationMoments } from './playbooks-compliance-ledger.mjs';

export function buildComplianceLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceLedgerWorkspace(workspaceName);
  const policies = createComplianceLedgerPolicies();
  return {
    workspace,
    summary: summarizeComplianceLedgerWorkspace(workspace),
    narratives: createComplianceLedgerNarratives(workspace),
    coverage: createComplianceLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceLedgerPolicies(policies),
    validation: validateComplianceLedgerPolicies(policies),
    escalationDeck: createComplianceLedgerEscalationDeck(policies),
    analytics: {
      timeline: createComplianceLedgerAnalyticsTimeline(),
      forecast: createComplianceLedgerForecastEnvelope(),
      exceptions: createComplianceLedgerExceptionLedger(),
      summary: summarizeComplianceLedgerAnalytics()
    },
    operations: {
      board: createComplianceLedgerOperationsBoard(),
      checklist: createComplianceLedgerShiftChecklist(),
      incidents: createComplianceLedgerIncidentDeck()
    },
    reporting: {
      cards: createComplianceLedgerReportCards(),
      packets: createComplianceLedgerReviewPackets(),
      summary: summarizeComplianceLedgerReporting()
    },
    audit: {
      trail: createComplianceLedgerAuditTrail(),
      manifest: createComplianceLedgerEvidenceManifest(),
      attestation: createComplianceLedgerReadinessAttestation()
    },
    playbooks: createComplianceLedgerPlaybooks(),
    decisions: createComplianceLedgerDecisionDeck(),
    escalationMoments: createComplianceLedgerEscalationMoments()
  };
}

export function createComplianceLedgerReadinessBoard(snapshot = buildComplianceLedgerSnapshot()) {
  return [
    { id: 'compliance-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceLedgerApiDocument(snapshot = buildComplianceLedgerSnapshot()) {
  return {
    id: 'compliance-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-ledger/overview' },
      { method: 'GET', path: '/api/compliance-ledger/reporting' },
      { method: 'POST', path: '/api/compliance-ledger/validate' },
      { method: 'GET', path: '/api/compliance-ledger/audit' }
    ],
    readiness: createComplianceLedgerReadinessBoard(snapshot)
  };
}

export function createComplianceLedgerRouteSummary(snapshot = buildComplianceLedgerSnapshot()) {
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

