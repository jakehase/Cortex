import { createConsentHubWorkspace, summarizeConsentHubWorkspace, createConsentHubNarratives, createConsentHubCoverageGrid } from './domain-consent-hub.mjs';
import { createConsentHubPolicies, validateConsentHubPolicies, summarizeConsentHubPolicies, createConsentHubEscalationDeck } from './policies-consent-hub.mjs';
import { createConsentHubAnalyticsTimeline, createConsentHubForecastEnvelope, createConsentHubExceptionLedger, summarizeConsentHubAnalytics } from './analytics-consent-hub.mjs';
import { createConsentHubOperationsBoard, createConsentHubShiftChecklist, createConsentHubIncidentDeck } from './operations-consent-hub.mjs';
import { createConsentHubReportCards, createConsentHubReviewPackets, summarizeConsentHubReporting } from './reporting-consent-hub.mjs';
import { createConsentHubAuditTrail, createConsentHubEvidenceManifest, createConsentHubReadinessAttestation } from './audit-consent-hub.mjs';
import { createConsentHubPlaybooks, createConsentHubDecisionDeck, createConsentHubEscalationMoments } from './playbooks-consent-hub.mjs';

export function buildConsentHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentHubWorkspace(workspaceName);
  const policies = createConsentHubPolicies();
  return {
    workspace,
    summary: summarizeConsentHubWorkspace(workspace),
    narratives: createConsentHubNarratives(workspace),
    coverage: createConsentHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentHubPolicies(policies),
    validation: validateConsentHubPolicies(policies),
    escalationDeck: createConsentHubEscalationDeck(policies),
    analytics: {
      timeline: createConsentHubAnalyticsTimeline(),
      forecast: createConsentHubForecastEnvelope(),
      exceptions: createConsentHubExceptionLedger(),
      summary: summarizeConsentHubAnalytics()
    },
    operations: {
      board: createConsentHubOperationsBoard(),
      checklist: createConsentHubShiftChecklist(),
      incidents: createConsentHubIncidentDeck()
    },
    reporting: {
      cards: createConsentHubReportCards(),
      packets: createConsentHubReviewPackets(),
      summary: summarizeConsentHubReporting()
    },
    audit: {
      trail: createConsentHubAuditTrail(),
      manifest: createConsentHubEvidenceManifest(),
      attestation: createConsentHubReadinessAttestation()
    },
    playbooks: createConsentHubPlaybooks(),
    decisions: createConsentHubDecisionDeck(),
    escalationMoments: createConsentHubEscalationMoments()
  };
}

export function createConsentHubReadinessBoard(snapshot = buildConsentHubSnapshot()) {
  return [
    { id: 'consent-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentHubApiDocument(snapshot = buildConsentHubSnapshot()) {
  return {
    id: 'consent-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-hub/overview' },
      { method: 'GET', path: '/api/consent-hub/reporting' },
      { method: 'POST', path: '/api/consent-hub/validate' },
      { method: 'GET', path: '/api/consent-hub/audit' }
    ],
    readiness: createConsentHubReadinessBoard(snapshot)
  };
}

export function createConsentHubRouteSummary(snapshot = buildConsentHubSnapshot()) {
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

