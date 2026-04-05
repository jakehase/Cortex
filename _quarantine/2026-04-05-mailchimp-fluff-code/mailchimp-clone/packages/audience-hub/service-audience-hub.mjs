import { createAudienceHubWorkspace, summarizeAudienceHubWorkspace, createAudienceHubNarratives, createAudienceHubCoverageGrid } from './domain-audience-hub.mjs';
import { createAudienceHubPolicies, validateAudienceHubPolicies, summarizeAudienceHubPolicies, createAudienceHubEscalationDeck } from './policies-audience-hub.mjs';
import { createAudienceHubAnalyticsTimeline, createAudienceHubForecastEnvelope, createAudienceHubExceptionLedger, summarizeAudienceHubAnalytics } from './analytics-audience-hub.mjs';
import { createAudienceHubOperationsBoard, createAudienceHubShiftChecklist, createAudienceHubIncidentDeck } from './operations-audience-hub.mjs';
import { createAudienceHubReportCards, createAudienceHubReviewPackets, summarizeAudienceHubReporting } from './reporting-audience-hub.mjs';
import { createAudienceHubAuditTrail, createAudienceHubEvidenceManifest, createAudienceHubReadinessAttestation } from './audit-audience-hub.mjs';
import { createAudienceHubPlaybooks, createAudienceHubDecisionDeck, createAudienceHubEscalationMoments } from './playbooks-audience-hub.mjs';

export function buildAudienceHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceHubWorkspace(workspaceName);
  const policies = createAudienceHubPolicies();
  return {
    workspace,
    summary: summarizeAudienceHubWorkspace(workspace),
    narratives: createAudienceHubNarratives(workspace),
    coverage: createAudienceHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceHubPolicies(policies),
    validation: validateAudienceHubPolicies(policies),
    escalationDeck: createAudienceHubEscalationDeck(policies),
    analytics: {
      timeline: createAudienceHubAnalyticsTimeline(),
      forecast: createAudienceHubForecastEnvelope(),
      exceptions: createAudienceHubExceptionLedger(),
      summary: summarizeAudienceHubAnalytics()
    },
    operations: {
      board: createAudienceHubOperationsBoard(),
      checklist: createAudienceHubShiftChecklist(),
      incidents: createAudienceHubIncidentDeck()
    },
    reporting: {
      cards: createAudienceHubReportCards(),
      packets: createAudienceHubReviewPackets(),
      summary: summarizeAudienceHubReporting()
    },
    audit: {
      trail: createAudienceHubAuditTrail(),
      manifest: createAudienceHubEvidenceManifest(),
      attestation: createAudienceHubReadinessAttestation()
    },
    playbooks: createAudienceHubPlaybooks(),
    decisions: createAudienceHubDecisionDeck(),
    escalationMoments: createAudienceHubEscalationMoments()
  };
}

export function createAudienceHubReadinessBoard(snapshot = buildAudienceHubSnapshot()) {
  return [
    { id: 'audience-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceHubApiDocument(snapshot = buildAudienceHubSnapshot()) {
  return {
    id: 'audience-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-hub/overview' },
      { method: 'GET', path: '/api/audience-hub/reporting' },
      { method: 'POST', path: '/api/audience-hub/validate' },
      { method: 'GET', path: '/api/audience-hub/audit' }
    ],
    readiness: createAudienceHubReadinessBoard(snapshot)
  };
}

export function createAudienceHubRouteSummary(snapshot = buildAudienceHubSnapshot()) {
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

