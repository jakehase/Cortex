import { createContentHubWorkspace, summarizeContentHubWorkspace, createContentHubNarratives, createContentHubCoverageGrid } from './domain-content-hub.mjs';
import { createContentHubPolicies, validateContentHubPolicies, summarizeContentHubPolicies, createContentHubEscalationDeck } from './policies-content-hub.mjs';
import { createContentHubAnalyticsTimeline, createContentHubForecastEnvelope, createContentHubExceptionLedger, summarizeContentHubAnalytics } from './analytics-content-hub.mjs';
import { createContentHubOperationsBoard, createContentHubShiftChecklist, createContentHubIncidentDeck } from './operations-content-hub.mjs';
import { createContentHubReportCards, createContentHubReviewPackets, summarizeContentHubReporting } from './reporting-content-hub.mjs';
import { createContentHubAuditTrail, createContentHubEvidenceManifest, createContentHubReadinessAttestation } from './audit-content-hub.mjs';
import { createContentHubPlaybooks, createContentHubDecisionDeck, createContentHubEscalationMoments } from './playbooks-content-hub.mjs';

export function buildContentHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentHubWorkspace(workspaceName);
  const policies = createContentHubPolicies();
  return {
    workspace,
    summary: summarizeContentHubWorkspace(workspace),
    narratives: createContentHubNarratives(workspace),
    coverage: createContentHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentHubPolicies(policies),
    validation: validateContentHubPolicies(policies),
    escalationDeck: createContentHubEscalationDeck(policies),
    analytics: {
      timeline: createContentHubAnalyticsTimeline(),
      forecast: createContentHubForecastEnvelope(),
      exceptions: createContentHubExceptionLedger(),
      summary: summarizeContentHubAnalytics()
    },
    operations: {
      board: createContentHubOperationsBoard(),
      checklist: createContentHubShiftChecklist(),
      incidents: createContentHubIncidentDeck()
    },
    reporting: {
      cards: createContentHubReportCards(),
      packets: createContentHubReviewPackets(),
      summary: summarizeContentHubReporting()
    },
    audit: {
      trail: createContentHubAuditTrail(),
      manifest: createContentHubEvidenceManifest(),
      attestation: createContentHubReadinessAttestation()
    },
    playbooks: createContentHubPlaybooks(),
    decisions: createContentHubDecisionDeck(),
    escalationMoments: createContentHubEscalationMoments()
  };
}

export function createContentHubReadinessBoard(snapshot = buildContentHubSnapshot()) {
  return [
    { id: 'content-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentHubApiDocument(snapshot = buildContentHubSnapshot()) {
  return {
    id: 'content-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-hub/overview' },
      { method: 'GET', path: '/api/content-hub/reporting' },
      { method: 'POST', path: '/api/content-hub/validate' },
      { method: 'GET', path: '/api/content-hub/audit' }
    ],
    readiness: createContentHubReadinessBoard(snapshot)
  };
}

export function createContentHubRouteSummary(snapshot = buildContentHubSnapshot()) {
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

