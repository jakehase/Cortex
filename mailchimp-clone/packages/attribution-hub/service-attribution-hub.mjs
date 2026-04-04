import { createAttributionHubWorkspace, summarizeAttributionHubWorkspace, createAttributionHubNarratives, createAttributionHubCoverageGrid } from './domain-attribution-hub.mjs';
import { createAttributionHubPolicies, validateAttributionHubPolicies, summarizeAttributionHubPolicies, createAttributionHubEscalationDeck } from './policies-attribution-hub.mjs';
import { createAttributionHubAnalyticsTimeline, createAttributionHubForecastEnvelope, createAttributionHubExceptionLedger, summarizeAttributionHubAnalytics } from './analytics-attribution-hub.mjs';
import { createAttributionHubOperationsBoard, createAttributionHubShiftChecklist, createAttributionHubIncidentDeck } from './operations-attribution-hub.mjs';
import { createAttributionHubReportCards, createAttributionHubReviewPackets, summarizeAttributionHubReporting } from './reporting-attribution-hub.mjs';
import { createAttributionHubAuditTrail, createAttributionHubEvidenceManifest, createAttributionHubReadinessAttestation } from './audit-attribution-hub.mjs';
import { createAttributionHubPlaybooks, createAttributionHubDecisionDeck, createAttributionHubEscalationMoments } from './playbooks-attribution-hub.mjs';

export function buildAttributionHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionHubWorkspace(workspaceName);
  const policies = createAttributionHubPolicies();
  return {
    workspace,
    summary: summarizeAttributionHubWorkspace(workspace),
    narratives: createAttributionHubNarratives(workspace),
    coverage: createAttributionHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionHubPolicies(policies),
    validation: validateAttributionHubPolicies(policies),
    escalationDeck: createAttributionHubEscalationDeck(policies),
    analytics: {
      timeline: createAttributionHubAnalyticsTimeline(),
      forecast: createAttributionHubForecastEnvelope(),
      exceptions: createAttributionHubExceptionLedger(),
      summary: summarizeAttributionHubAnalytics()
    },
    operations: {
      board: createAttributionHubOperationsBoard(),
      checklist: createAttributionHubShiftChecklist(),
      incidents: createAttributionHubIncidentDeck()
    },
    reporting: {
      cards: createAttributionHubReportCards(),
      packets: createAttributionHubReviewPackets(),
      summary: summarizeAttributionHubReporting()
    },
    audit: {
      trail: createAttributionHubAuditTrail(),
      manifest: createAttributionHubEvidenceManifest(),
      attestation: createAttributionHubReadinessAttestation()
    },
    playbooks: createAttributionHubPlaybooks(),
    decisions: createAttributionHubDecisionDeck(),
    escalationMoments: createAttributionHubEscalationMoments()
  };
}

export function createAttributionHubReadinessBoard(snapshot = buildAttributionHubSnapshot()) {
  return [
    { id: 'attribution-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionHubApiDocument(snapshot = buildAttributionHubSnapshot()) {
  return {
    id: 'attribution-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-hub/overview' },
      { method: 'GET', path: '/api/attribution-hub/reporting' },
      { method: 'POST', path: '/api/attribution-hub/validate' },
      { method: 'GET', path: '/api/attribution-hub/audit' }
    ],
    readiness: createAttributionHubReadinessBoard(snapshot)
  };
}

export function createAttributionHubRouteSummary(snapshot = buildAttributionHubSnapshot()) {
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

