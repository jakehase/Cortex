import { createAcquisitionHubWorkspace, summarizeAcquisitionHubWorkspace, createAcquisitionHubNarratives, createAcquisitionHubCoverageGrid } from './domain-acquisition-hub.mjs';
import { createAcquisitionHubPolicies, validateAcquisitionHubPolicies, summarizeAcquisitionHubPolicies, createAcquisitionHubEscalationDeck } from './policies-acquisition-hub.mjs';
import { createAcquisitionHubAnalyticsTimeline, createAcquisitionHubForecastEnvelope, createAcquisitionHubExceptionLedger, summarizeAcquisitionHubAnalytics } from './analytics-acquisition-hub.mjs';
import { createAcquisitionHubOperationsBoard, createAcquisitionHubShiftChecklist, createAcquisitionHubIncidentDeck } from './operations-acquisition-hub.mjs';
import { createAcquisitionHubReportCards, createAcquisitionHubReviewPackets, summarizeAcquisitionHubReporting } from './reporting-acquisition-hub.mjs';
import { createAcquisitionHubAuditTrail, createAcquisitionHubEvidenceManifest, createAcquisitionHubReadinessAttestation } from './audit-acquisition-hub.mjs';
import { createAcquisitionHubPlaybooks, createAcquisitionHubDecisionDeck, createAcquisitionHubEscalationMoments } from './playbooks-acquisition-hub.mjs';

export function buildAcquisitionHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionHubWorkspace(workspaceName);
  const policies = createAcquisitionHubPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionHubWorkspace(workspace),
    narratives: createAcquisitionHubNarratives(workspace),
    coverage: createAcquisitionHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionHubPolicies(policies),
    validation: validateAcquisitionHubPolicies(policies),
    escalationDeck: createAcquisitionHubEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionHubAnalyticsTimeline(),
      forecast: createAcquisitionHubForecastEnvelope(),
      exceptions: createAcquisitionHubExceptionLedger(),
      summary: summarizeAcquisitionHubAnalytics()
    },
    operations: {
      board: createAcquisitionHubOperationsBoard(),
      checklist: createAcquisitionHubShiftChecklist(),
      incidents: createAcquisitionHubIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionHubReportCards(),
      packets: createAcquisitionHubReviewPackets(),
      summary: summarizeAcquisitionHubReporting()
    },
    audit: {
      trail: createAcquisitionHubAuditTrail(),
      manifest: createAcquisitionHubEvidenceManifest(),
      attestation: createAcquisitionHubReadinessAttestation()
    },
    playbooks: createAcquisitionHubPlaybooks(),
    decisions: createAcquisitionHubDecisionDeck(),
    escalationMoments: createAcquisitionHubEscalationMoments()
  };
}

export function createAcquisitionHubReadinessBoard(snapshot = buildAcquisitionHubSnapshot()) {
  return [
    { id: 'acquisition-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionHubApiDocument(snapshot = buildAcquisitionHubSnapshot()) {
  return {
    id: 'acquisition-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-hub/overview' },
      { method: 'GET', path: '/api/acquisition-hub/reporting' },
      { method: 'POST', path: '/api/acquisition-hub/validate' },
      { method: 'GET', path: '/api/acquisition-hub/audit' }
    ],
    readiness: createAcquisitionHubReadinessBoard(snapshot)
  };
}

export function createAcquisitionHubRouteSummary(snapshot = buildAcquisitionHubSnapshot()) {
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

