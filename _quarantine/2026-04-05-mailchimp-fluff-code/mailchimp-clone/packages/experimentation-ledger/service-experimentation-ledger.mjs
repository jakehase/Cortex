import { createExperimentationLedgerWorkspace, summarizeExperimentationLedgerWorkspace, createExperimentationLedgerNarratives, createExperimentationLedgerCoverageGrid } from './domain-experimentation-ledger.mjs';
import { createExperimentationLedgerPolicies, validateExperimentationLedgerPolicies, summarizeExperimentationLedgerPolicies, createExperimentationLedgerEscalationDeck } from './policies-experimentation-ledger.mjs';
import { createExperimentationLedgerAnalyticsTimeline, createExperimentationLedgerForecastEnvelope, createExperimentationLedgerExceptionLedger, summarizeExperimentationLedgerAnalytics } from './analytics-experimentation-ledger.mjs';
import { createExperimentationLedgerOperationsBoard, createExperimentationLedgerShiftChecklist, createExperimentationLedgerIncidentDeck } from './operations-experimentation-ledger.mjs';
import { createExperimentationLedgerReportCards, createExperimentationLedgerReviewPackets, summarizeExperimentationLedgerReporting } from './reporting-experimentation-ledger.mjs';
import { createExperimentationLedgerAuditTrail, createExperimentationLedgerEvidenceManifest, createExperimentationLedgerReadinessAttestation } from './audit-experimentation-ledger.mjs';
import { createExperimentationLedgerPlaybooks, createExperimentationLedgerDecisionDeck, createExperimentationLedgerEscalationMoments } from './playbooks-experimentation-ledger.mjs';

export function buildExperimentationLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationLedgerWorkspace(workspaceName);
  const policies = createExperimentationLedgerPolicies();
  return {
    workspace,
    summary: summarizeExperimentationLedgerWorkspace(workspace),
    narratives: createExperimentationLedgerNarratives(workspace),
    coverage: createExperimentationLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationLedgerPolicies(policies),
    validation: validateExperimentationLedgerPolicies(policies),
    escalationDeck: createExperimentationLedgerEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationLedgerAnalyticsTimeline(),
      forecast: createExperimentationLedgerForecastEnvelope(),
      exceptions: createExperimentationLedgerExceptionLedger(),
      summary: summarizeExperimentationLedgerAnalytics()
    },
    operations: {
      board: createExperimentationLedgerOperationsBoard(),
      checklist: createExperimentationLedgerShiftChecklist(),
      incidents: createExperimentationLedgerIncidentDeck()
    },
    reporting: {
      cards: createExperimentationLedgerReportCards(),
      packets: createExperimentationLedgerReviewPackets(),
      summary: summarizeExperimentationLedgerReporting()
    },
    audit: {
      trail: createExperimentationLedgerAuditTrail(),
      manifest: createExperimentationLedgerEvidenceManifest(),
      attestation: createExperimentationLedgerReadinessAttestation()
    },
    playbooks: createExperimentationLedgerPlaybooks(),
    decisions: createExperimentationLedgerDecisionDeck(),
    escalationMoments: createExperimentationLedgerEscalationMoments()
  };
}

export function createExperimentationLedgerReadinessBoard(snapshot = buildExperimentationLedgerSnapshot()) {
  return [
    { id: 'experimentation-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationLedgerApiDocument(snapshot = buildExperimentationLedgerSnapshot()) {
  return {
    id: 'experimentation-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-ledger/overview' },
      { method: 'GET', path: '/api/experimentation-ledger/reporting' },
      { method: 'POST', path: '/api/experimentation-ledger/validate' },
      { method: 'GET', path: '/api/experimentation-ledger/audit' }
    ],
    readiness: createExperimentationLedgerReadinessBoard(snapshot)
  };
}

export function createExperimentationLedgerRouteSummary(snapshot = buildExperimentationLedgerSnapshot()) {
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

