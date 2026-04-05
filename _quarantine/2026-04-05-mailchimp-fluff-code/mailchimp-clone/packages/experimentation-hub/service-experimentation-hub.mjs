import { createExperimentationHubWorkspace, summarizeExperimentationHubWorkspace, createExperimentationHubNarratives, createExperimentationHubCoverageGrid } from './domain-experimentation-hub.mjs';
import { createExperimentationHubPolicies, validateExperimentationHubPolicies, summarizeExperimentationHubPolicies, createExperimentationHubEscalationDeck } from './policies-experimentation-hub.mjs';
import { createExperimentationHubAnalyticsTimeline, createExperimentationHubForecastEnvelope, createExperimentationHubExceptionLedger, summarizeExperimentationHubAnalytics } from './analytics-experimentation-hub.mjs';
import { createExperimentationHubOperationsBoard, createExperimentationHubShiftChecklist, createExperimentationHubIncidentDeck } from './operations-experimentation-hub.mjs';
import { createExperimentationHubReportCards, createExperimentationHubReviewPackets, summarizeExperimentationHubReporting } from './reporting-experimentation-hub.mjs';
import { createExperimentationHubAuditTrail, createExperimentationHubEvidenceManifest, createExperimentationHubReadinessAttestation } from './audit-experimentation-hub.mjs';
import { createExperimentationHubPlaybooks, createExperimentationHubDecisionDeck, createExperimentationHubEscalationMoments } from './playbooks-experimentation-hub.mjs';

export function buildExperimentationHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationHubWorkspace(workspaceName);
  const policies = createExperimentationHubPolicies();
  return {
    workspace,
    summary: summarizeExperimentationHubWorkspace(workspace),
    narratives: createExperimentationHubNarratives(workspace),
    coverage: createExperimentationHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationHubPolicies(policies),
    validation: validateExperimentationHubPolicies(policies),
    escalationDeck: createExperimentationHubEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationHubAnalyticsTimeline(),
      forecast: createExperimentationHubForecastEnvelope(),
      exceptions: createExperimentationHubExceptionLedger(),
      summary: summarizeExperimentationHubAnalytics()
    },
    operations: {
      board: createExperimentationHubOperationsBoard(),
      checklist: createExperimentationHubShiftChecklist(),
      incidents: createExperimentationHubIncidentDeck()
    },
    reporting: {
      cards: createExperimentationHubReportCards(),
      packets: createExperimentationHubReviewPackets(),
      summary: summarizeExperimentationHubReporting()
    },
    audit: {
      trail: createExperimentationHubAuditTrail(),
      manifest: createExperimentationHubEvidenceManifest(),
      attestation: createExperimentationHubReadinessAttestation()
    },
    playbooks: createExperimentationHubPlaybooks(),
    decisions: createExperimentationHubDecisionDeck(),
    escalationMoments: createExperimentationHubEscalationMoments()
  };
}

export function createExperimentationHubReadinessBoard(snapshot = buildExperimentationHubSnapshot()) {
  return [
    { id: 'experimentation-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationHubApiDocument(snapshot = buildExperimentationHubSnapshot()) {
  return {
    id: 'experimentation-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-hub/overview' },
      { method: 'GET', path: '/api/experimentation-hub/reporting' },
      { method: 'POST', path: '/api/experimentation-hub/validate' },
      { method: 'GET', path: '/api/experimentation-hub/audit' }
    ],
    readiness: createExperimentationHubReadinessBoard(snapshot)
  };
}

export function createExperimentationHubRouteSummary(snapshot = buildExperimentationHubSnapshot()) {
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

