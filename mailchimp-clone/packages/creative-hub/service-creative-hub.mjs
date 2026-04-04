import { createCreativeHubWorkspace, summarizeCreativeHubWorkspace, createCreativeHubNarratives, createCreativeHubCoverageGrid } from './domain-creative-hub.mjs';
import { createCreativeHubPolicies, validateCreativeHubPolicies, summarizeCreativeHubPolicies, createCreativeHubEscalationDeck } from './policies-creative-hub.mjs';
import { createCreativeHubAnalyticsTimeline, createCreativeHubForecastEnvelope, createCreativeHubExceptionLedger, summarizeCreativeHubAnalytics } from './analytics-creative-hub.mjs';
import { createCreativeHubOperationsBoard, createCreativeHubShiftChecklist, createCreativeHubIncidentDeck } from './operations-creative-hub.mjs';
import { createCreativeHubReportCards, createCreativeHubReviewPackets, summarizeCreativeHubReporting } from './reporting-creative-hub.mjs';
import { createCreativeHubAuditTrail, createCreativeHubEvidenceManifest, createCreativeHubReadinessAttestation } from './audit-creative-hub.mjs';
import { createCreativeHubPlaybooks, createCreativeHubDecisionDeck, createCreativeHubEscalationMoments } from './playbooks-creative-hub.mjs';

export function buildCreativeHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeHubWorkspace(workspaceName);
  const policies = createCreativeHubPolicies();
  return {
    workspace,
    summary: summarizeCreativeHubWorkspace(workspace),
    narratives: createCreativeHubNarratives(workspace),
    coverage: createCreativeHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeHubPolicies(policies),
    validation: validateCreativeHubPolicies(policies),
    escalationDeck: createCreativeHubEscalationDeck(policies),
    analytics: {
      timeline: createCreativeHubAnalyticsTimeline(),
      forecast: createCreativeHubForecastEnvelope(),
      exceptions: createCreativeHubExceptionLedger(),
      summary: summarizeCreativeHubAnalytics()
    },
    operations: {
      board: createCreativeHubOperationsBoard(),
      checklist: createCreativeHubShiftChecklist(),
      incidents: createCreativeHubIncidentDeck()
    },
    reporting: {
      cards: createCreativeHubReportCards(),
      packets: createCreativeHubReviewPackets(),
      summary: summarizeCreativeHubReporting()
    },
    audit: {
      trail: createCreativeHubAuditTrail(),
      manifest: createCreativeHubEvidenceManifest(),
      attestation: createCreativeHubReadinessAttestation()
    },
    playbooks: createCreativeHubPlaybooks(),
    decisions: createCreativeHubDecisionDeck(),
    escalationMoments: createCreativeHubEscalationMoments()
  };
}

export function createCreativeHubReadinessBoard(snapshot = buildCreativeHubSnapshot()) {
  return [
    { id: 'creative-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeHubApiDocument(snapshot = buildCreativeHubSnapshot()) {
  return {
    id: 'creative-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-hub/overview' },
      { method: 'GET', path: '/api/creative-hub/reporting' },
      { method: 'POST', path: '/api/creative-hub/validate' },
      { method: 'GET', path: '/api/creative-hub/audit' }
    ],
    readiness: createCreativeHubReadinessBoard(snapshot)
  };
}

export function createCreativeHubRouteSummary(snapshot = buildCreativeHubSnapshot()) {
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

