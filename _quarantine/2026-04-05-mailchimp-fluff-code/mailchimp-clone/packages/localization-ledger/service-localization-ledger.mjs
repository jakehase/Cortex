import { createLocalizationLedgerWorkspace, summarizeLocalizationLedgerWorkspace, createLocalizationLedgerNarratives, createLocalizationLedgerCoverageGrid } from './domain-localization-ledger.mjs';
import { createLocalizationLedgerPolicies, validateLocalizationLedgerPolicies, summarizeLocalizationLedgerPolicies, createLocalizationLedgerEscalationDeck } from './policies-localization-ledger.mjs';
import { createLocalizationLedgerAnalyticsTimeline, createLocalizationLedgerForecastEnvelope, createLocalizationLedgerExceptionLedger, summarizeLocalizationLedgerAnalytics } from './analytics-localization-ledger.mjs';
import { createLocalizationLedgerOperationsBoard, createLocalizationLedgerShiftChecklist, createLocalizationLedgerIncidentDeck } from './operations-localization-ledger.mjs';
import { createLocalizationLedgerReportCards, createLocalizationLedgerReviewPackets, summarizeLocalizationLedgerReporting } from './reporting-localization-ledger.mjs';
import { createLocalizationLedgerAuditTrail, createLocalizationLedgerEvidenceManifest, createLocalizationLedgerReadinessAttestation } from './audit-localization-ledger.mjs';
import { createLocalizationLedgerPlaybooks, createLocalizationLedgerDecisionDeck, createLocalizationLedgerEscalationMoments } from './playbooks-localization-ledger.mjs';

export function buildLocalizationLedgerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationLedgerWorkspace(workspaceName);
  const policies = createLocalizationLedgerPolicies();
  return {
    workspace,
    summary: summarizeLocalizationLedgerWorkspace(workspace),
    narratives: createLocalizationLedgerNarratives(workspace),
    coverage: createLocalizationLedgerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationLedgerPolicies(policies),
    validation: validateLocalizationLedgerPolicies(policies),
    escalationDeck: createLocalizationLedgerEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationLedgerAnalyticsTimeline(),
      forecast: createLocalizationLedgerForecastEnvelope(),
      exceptions: createLocalizationLedgerExceptionLedger(),
      summary: summarizeLocalizationLedgerAnalytics()
    },
    operations: {
      board: createLocalizationLedgerOperationsBoard(),
      checklist: createLocalizationLedgerShiftChecklist(),
      incidents: createLocalizationLedgerIncidentDeck()
    },
    reporting: {
      cards: createLocalizationLedgerReportCards(),
      packets: createLocalizationLedgerReviewPackets(),
      summary: summarizeLocalizationLedgerReporting()
    },
    audit: {
      trail: createLocalizationLedgerAuditTrail(),
      manifest: createLocalizationLedgerEvidenceManifest(),
      attestation: createLocalizationLedgerReadinessAttestation()
    },
    playbooks: createLocalizationLedgerPlaybooks(),
    decisions: createLocalizationLedgerDecisionDeck(),
    escalationMoments: createLocalizationLedgerEscalationMoments()
  };
}

export function createLocalizationLedgerReadinessBoard(snapshot = buildLocalizationLedgerSnapshot()) {
  return [
    { id: 'localization-ledger-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-ledger-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-ledger-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-ledger-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationLedgerApiDocument(snapshot = buildLocalizationLedgerSnapshot()) {
  return {
    id: 'localization-ledger-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-ledger/overview' },
      { method: 'GET', path: '/api/localization-ledger/reporting' },
      { method: 'POST', path: '/api/localization-ledger/validate' },
      { method: 'GET', path: '/api/localization-ledger/audit' }
    ],
    readiness: createLocalizationLedgerReadinessBoard(snapshot)
  };
}

export function createLocalizationLedgerRouteSummary(snapshot = buildLocalizationLedgerSnapshot()) {
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

