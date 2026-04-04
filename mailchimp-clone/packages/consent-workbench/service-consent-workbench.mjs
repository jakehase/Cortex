import { createConsentWorkbenchWorkspace, summarizeConsentWorkbenchWorkspace, createConsentWorkbenchNarratives, createConsentWorkbenchCoverageGrid } from './domain-consent-workbench.mjs';
import { createConsentWorkbenchPolicies, validateConsentWorkbenchPolicies, summarizeConsentWorkbenchPolicies, createConsentWorkbenchEscalationDeck } from './policies-consent-workbench.mjs';
import { createConsentWorkbenchAnalyticsTimeline, createConsentWorkbenchForecastEnvelope, createConsentWorkbenchExceptionLedger, summarizeConsentWorkbenchAnalytics } from './analytics-consent-workbench.mjs';
import { createConsentWorkbenchOperationsBoard, createConsentWorkbenchShiftChecklist, createConsentWorkbenchIncidentDeck } from './operations-consent-workbench.mjs';
import { createConsentWorkbenchReportCards, createConsentWorkbenchReviewPackets, summarizeConsentWorkbenchReporting } from './reporting-consent-workbench.mjs';
import { createConsentWorkbenchAuditTrail, createConsentWorkbenchEvidenceManifest, createConsentWorkbenchReadinessAttestation } from './audit-consent-workbench.mjs';
import { createConsentWorkbenchPlaybooks, createConsentWorkbenchDecisionDeck, createConsentWorkbenchEscalationMoments } from './playbooks-consent-workbench.mjs';

export function buildConsentWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentWorkbenchWorkspace(workspaceName);
  const policies = createConsentWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeConsentWorkbenchWorkspace(workspace),
    narratives: createConsentWorkbenchNarratives(workspace),
    coverage: createConsentWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentWorkbenchPolicies(policies),
    validation: validateConsentWorkbenchPolicies(policies),
    escalationDeck: createConsentWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createConsentWorkbenchAnalyticsTimeline(),
      forecast: createConsentWorkbenchForecastEnvelope(),
      exceptions: createConsentWorkbenchExceptionLedger(),
      summary: summarizeConsentWorkbenchAnalytics()
    },
    operations: {
      board: createConsentWorkbenchOperationsBoard(),
      checklist: createConsentWorkbenchShiftChecklist(),
      incidents: createConsentWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createConsentWorkbenchReportCards(),
      packets: createConsentWorkbenchReviewPackets(),
      summary: summarizeConsentWorkbenchReporting()
    },
    audit: {
      trail: createConsentWorkbenchAuditTrail(),
      manifest: createConsentWorkbenchEvidenceManifest(),
      attestation: createConsentWorkbenchReadinessAttestation()
    },
    playbooks: createConsentWorkbenchPlaybooks(),
    decisions: createConsentWorkbenchDecisionDeck(),
    escalationMoments: createConsentWorkbenchEscalationMoments()
  };
}

export function createConsentWorkbenchReadinessBoard(snapshot = buildConsentWorkbenchSnapshot()) {
  return [
    { id: 'consent-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentWorkbenchApiDocument(snapshot = buildConsentWorkbenchSnapshot()) {
  return {
    id: 'consent-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-workbench/overview' },
      { method: 'GET', path: '/api/consent-workbench/reporting' },
      { method: 'POST', path: '/api/consent-workbench/validate' },
      { method: 'GET', path: '/api/consent-workbench/audit' }
    ],
    readiness: createConsentWorkbenchReadinessBoard(snapshot)
  };
}

export function createConsentWorkbenchRouteSummary(snapshot = buildConsentWorkbenchSnapshot()) {
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

