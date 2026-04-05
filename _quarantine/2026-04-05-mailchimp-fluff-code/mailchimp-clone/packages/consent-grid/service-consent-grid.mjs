import { createConsentGridWorkspace, summarizeConsentGridWorkspace, createConsentGridNarratives, createConsentGridCoverageGrid } from './domain-consent-grid.mjs';
import { createConsentGridPolicies, validateConsentGridPolicies, summarizeConsentGridPolicies, createConsentGridEscalationDeck } from './policies-consent-grid.mjs';
import { createConsentGridAnalyticsTimeline, createConsentGridForecastEnvelope, createConsentGridExceptionLedger, summarizeConsentGridAnalytics } from './analytics-consent-grid.mjs';
import { createConsentGridOperationsBoard, createConsentGridShiftChecklist, createConsentGridIncidentDeck } from './operations-consent-grid.mjs';
import { createConsentGridReportCards, createConsentGridReviewPackets, summarizeConsentGridReporting } from './reporting-consent-grid.mjs';
import { createConsentGridAuditTrail, createConsentGridEvidenceManifest, createConsentGridReadinessAttestation } from './audit-consent-grid.mjs';
import { createConsentGridPlaybooks, createConsentGridDecisionDeck, createConsentGridEscalationMoments } from './playbooks-consent-grid.mjs';

export function buildConsentGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentGridWorkspace(workspaceName);
  const policies = createConsentGridPolicies();
  return {
    workspace,
    summary: summarizeConsentGridWorkspace(workspace),
    narratives: createConsentGridNarratives(workspace),
    coverage: createConsentGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentGridPolicies(policies),
    validation: validateConsentGridPolicies(policies),
    escalationDeck: createConsentGridEscalationDeck(policies),
    analytics: {
      timeline: createConsentGridAnalyticsTimeline(),
      forecast: createConsentGridForecastEnvelope(),
      exceptions: createConsentGridExceptionLedger(),
      summary: summarizeConsentGridAnalytics()
    },
    operations: {
      board: createConsentGridOperationsBoard(),
      checklist: createConsentGridShiftChecklist(),
      incidents: createConsentGridIncidentDeck()
    },
    reporting: {
      cards: createConsentGridReportCards(),
      packets: createConsentGridReviewPackets(),
      summary: summarizeConsentGridReporting()
    },
    audit: {
      trail: createConsentGridAuditTrail(),
      manifest: createConsentGridEvidenceManifest(),
      attestation: createConsentGridReadinessAttestation()
    },
    playbooks: createConsentGridPlaybooks(),
    decisions: createConsentGridDecisionDeck(),
    escalationMoments: createConsentGridEscalationMoments()
  };
}

export function createConsentGridReadinessBoard(snapshot = buildConsentGridSnapshot()) {
  return [
    { id: 'consent-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentGridApiDocument(snapshot = buildConsentGridSnapshot()) {
  return {
    id: 'consent-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-grid/overview' },
      { method: 'GET', path: '/api/consent-grid/reporting' },
      { method: 'POST', path: '/api/consent-grid/validate' },
      { method: 'GET', path: '/api/consent-grid/audit' }
    ],
    readiness: createConsentGridReadinessBoard(snapshot)
  };
}

export function createConsentGridRouteSummary(snapshot = buildConsentGridSnapshot()) {
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

