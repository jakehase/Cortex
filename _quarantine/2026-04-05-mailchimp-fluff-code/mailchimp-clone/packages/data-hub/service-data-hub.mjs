import { createDataHubWorkspace, summarizeDataHubWorkspace, createDataHubNarratives, createDataHubCoverageGrid } from './domain-data-hub.mjs';
import { createDataHubPolicies, validateDataHubPolicies, summarizeDataHubPolicies, createDataHubEscalationDeck } from './policies-data-hub.mjs';
import { createDataHubAnalyticsTimeline, createDataHubForecastEnvelope, createDataHubExceptionLedger, summarizeDataHubAnalytics } from './analytics-data-hub.mjs';
import { createDataHubOperationsBoard, createDataHubShiftChecklist, createDataHubIncidentDeck } from './operations-data-hub.mjs';
import { createDataHubReportCards, createDataHubReviewPackets, summarizeDataHubReporting } from './reporting-data-hub.mjs';
import { createDataHubAuditTrail, createDataHubEvidenceManifest, createDataHubReadinessAttestation } from './audit-data-hub.mjs';
import { createDataHubPlaybooks, createDataHubDecisionDeck, createDataHubEscalationMoments } from './playbooks-data-hub.mjs';

export function buildDataHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataHubWorkspace(workspaceName);
  const policies = createDataHubPolicies();
  return {
    workspace,
    summary: summarizeDataHubWorkspace(workspace),
    narratives: createDataHubNarratives(workspace),
    coverage: createDataHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataHubPolicies(policies),
    validation: validateDataHubPolicies(policies),
    escalationDeck: createDataHubEscalationDeck(policies),
    analytics: {
      timeline: createDataHubAnalyticsTimeline(),
      forecast: createDataHubForecastEnvelope(),
      exceptions: createDataHubExceptionLedger(),
      summary: summarizeDataHubAnalytics()
    },
    operations: {
      board: createDataHubOperationsBoard(),
      checklist: createDataHubShiftChecklist(),
      incidents: createDataHubIncidentDeck()
    },
    reporting: {
      cards: createDataHubReportCards(),
      packets: createDataHubReviewPackets(),
      summary: summarizeDataHubReporting()
    },
    audit: {
      trail: createDataHubAuditTrail(),
      manifest: createDataHubEvidenceManifest(),
      attestation: createDataHubReadinessAttestation()
    },
    playbooks: createDataHubPlaybooks(),
    decisions: createDataHubDecisionDeck(),
    escalationMoments: createDataHubEscalationMoments()
  };
}

export function createDataHubReadinessBoard(snapshot = buildDataHubSnapshot()) {
  return [
    { id: 'data-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataHubApiDocument(snapshot = buildDataHubSnapshot()) {
  return {
    id: 'data-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-hub/overview' },
      { method: 'GET', path: '/api/data-hub/reporting' },
      { method: 'POST', path: '/api/data-hub/validate' },
      { method: 'GET', path: '/api/data-hub/audit' }
    ],
    readiness: createDataHubReadinessBoard(snapshot)
  };
}

export function createDataHubRouteSummary(snapshot = buildDataHubSnapshot()) {
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

