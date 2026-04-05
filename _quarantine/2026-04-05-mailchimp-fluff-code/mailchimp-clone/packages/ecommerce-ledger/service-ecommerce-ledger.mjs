import { createEcommerceLedgerWorkspace, summarizeEcommerceLedgerWorkspace, createEcommerceLedgerNarratives, createEcommerceLedgerCoverageGrid } from './domain-ecommerce-ledger.mjs';
import { createEcommerceLedgerPolicies, validateEcommerceLedgerPolicies, summarizeEcommerceLedgerPolicies, createEcommerceLedgerEscalationDeck } from './policies-ecommerce-ledger.mjs';
import { createEcommerceLedgerAnalyticsTimeline, createEcommerceLedgerForecastEnvelope, createEcommerceLedgerExceptionLedger, summarizeEcommerceLedgerAnalytics } from './analytics-ecommerce-ledger.mjs';
import { createEcommerceLedgerOperationsBoard, createEcommerceLedgerShiftChecklist, createEcommerceLedgerIncidentDeck } from './operations-ecommerce-ledger.mjs';
import { createEcommerceLedgerReportCards, createEcommerceLedgerReviewPackets, summarizeEcommerceLedgerReporting } from './reporting-ecommerce-ledger.mjs';
import { createEcommerceLedgerAuditTrail, createEcommerceLedgerEvidenceManifest, createEcommerceLedgerReadinessAttestation } from './audit-ecommerce-ledger.mjs';
import { createEcommerceLedgerPlaybooks, createEcommerceLedgerDecisionDeck, createEcommerceLedgerEscalationMoments } from './playbooks-ecommerce-ledger.mjs';

export function buildEcommerceLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceLedgerWorkspace(workspaceName);
  const policies = createEcommerceLedgerPolicies();
  return {
    workspace,
    summary: summarizeEcommerceLedgerWorkspace(workspace),
    narratives: createEcommerceLedgerNarratives(workspace),
    coverage: createEcommerceLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceLedgerPolicies(policies),
    validation: validateEcommerceLedgerPolicies(policies),
    escalationDeck: createEcommerceLedgerEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceLedgerAnalyticsTimeline(),
      forecast: createEcommerceLedgerForecastEnvelope(),
      exceptions: createEcommerceLedgerExceptionLedger(),
      summary: summarizeEcommerceLedgerAnalytics()
    },
    operations: {
      board: createEcommerceLedgerOperationsBoard(),
      checklist: createEcommerceLedgerShiftChecklist(),
      incidents: createEcommerceLedgerIncidentDeck()
    },
    reporting: {
      cards: createEcommerceLedgerReportCards(),
      packets: createEcommerceLedgerReviewPackets(),
      summary: summarizeEcommerceLedgerReporting()
    },
    audit: {
      trail: createEcommerceLedgerAuditTrail(),
      manifest: createEcommerceLedgerEvidenceManifest(),
      attestation: createEcommerceLedgerReadinessAttestation()
    },
    playbooks: createEcommerceLedgerPlaybooks(),
    decisions: createEcommerceLedgerDecisionDeck(),
    escalationMoments: createEcommerceLedgerEscalationMoments()
  };
}

export function createEcommerceLedgerReadinessBoard(snapshot = buildEcommerceLedgerSnapshot()) {
  return [
    { id: 'ecommerce-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceLedgerApiDocument(snapshot = buildEcommerceLedgerSnapshot()) {
  return {
    id: 'ecommerce-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-ledger/overview' },
      { method: 'GET', path: '/api/ecommerce-ledger/reporting' },
      { method: 'POST', path: '/api/ecommerce-ledger/validate' },
      { method: 'GET', path: '/api/ecommerce-ledger/audit' }
    ],
    readiness: createEcommerceLedgerReadinessBoard(snapshot)
  };
}

export function createEcommerceLedgerRouteSummary(snapshot = buildEcommerceLedgerSnapshot()) {
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

