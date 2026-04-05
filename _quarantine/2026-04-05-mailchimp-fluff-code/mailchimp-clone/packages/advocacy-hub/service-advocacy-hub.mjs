import { createAdvocacyHubWorkspace, summarizeAdvocacyHubWorkspace, createAdvocacyHubNarratives, createAdvocacyHubCoverageGrid } from './domain-advocacy-hub.mjs';
import { createAdvocacyHubPolicies, validateAdvocacyHubPolicies, summarizeAdvocacyHubPolicies, createAdvocacyHubEscalationDeck } from './policies-advocacy-hub.mjs';
import { createAdvocacyHubAnalyticsTimeline, createAdvocacyHubForecastEnvelope, createAdvocacyHubExceptionLedger, summarizeAdvocacyHubAnalytics } from './analytics-advocacy-hub.mjs';
import { createAdvocacyHubOperationsBoard, createAdvocacyHubShiftChecklist, createAdvocacyHubIncidentDeck } from './operations-advocacy-hub.mjs';
import { createAdvocacyHubReportCards, createAdvocacyHubReviewPackets, summarizeAdvocacyHubReporting } from './reporting-advocacy-hub.mjs';
import { createAdvocacyHubAuditTrail, createAdvocacyHubEvidenceManifest, createAdvocacyHubReadinessAttestation } from './audit-advocacy-hub.mjs';
import { createAdvocacyHubPlaybooks, createAdvocacyHubDecisionDeck, createAdvocacyHubEscalationMoments } from './playbooks-advocacy-hub.mjs';

export function buildAdvocacyHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyHubWorkspace(workspaceName);
  const policies = createAdvocacyHubPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyHubWorkspace(workspace),
    narratives: createAdvocacyHubNarratives(workspace),
    coverage: createAdvocacyHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyHubPolicies(policies),
    validation: validateAdvocacyHubPolicies(policies),
    escalationDeck: createAdvocacyHubEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyHubAnalyticsTimeline(),
      forecast: createAdvocacyHubForecastEnvelope(),
      exceptions: createAdvocacyHubExceptionLedger(),
      summary: summarizeAdvocacyHubAnalytics()
    },
    operations: {
      board: createAdvocacyHubOperationsBoard(),
      checklist: createAdvocacyHubShiftChecklist(),
      incidents: createAdvocacyHubIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyHubReportCards(),
      packets: createAdvocacyHubReviewPackets(),
      summary: summarizeAdvocacyHubReporting()
    },
    audit: {
      trail: createAdvocacyHubAuditTrail(),
      manifest: createAdvocacyHubEvidenceManifest(),
      attestation: createAdvocacyHubReadinessAttestation()
    },
    playbooks: createAdvocacyHubPlaybooks(),
    decisions: createAdvocacyHubDecisionDeck(),
    escalationMoments: createAdvocacyHubEscalationMoments()
  };
}

export function createAdvocacyHubReadinessBoard(snapshot = buildAdvocacyHubSnapshot()) {
  return [
    { id: 'advocacy-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyHubApiDocument(snapshot = buildAdvocacyHubSnapshot()) {
  return {
    id: 'advocacy-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-hub/overview' },
      { method: 'GET', path: '/api/advocacy-hub/reporting' },
      { method: 'POST', path: '/api/advocacy-hub/validate' },
      { method: 'GET', path: '/api/advocacy-hub/audit' }
    ],
    readiness: createAdvocacyHubReadinessBoard(snapshot)
  };
}

export function createAdvocacyHubRouteSummary(snapshot = buildAdvocacyHubSnapshot()) {
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

