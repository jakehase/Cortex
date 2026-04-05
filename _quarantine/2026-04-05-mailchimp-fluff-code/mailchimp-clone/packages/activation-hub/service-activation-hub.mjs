import { createActivationHubWorkspace, summarizeActivationHubWorkspace, createActivationHubNarratives, createActivationHubCoverageGrid } from './domain-activation-hub.mjs';
import { createActivationHubPolicies, validateActivationHubPolicies, summarizeActivationHubPolicies, createActivationHubEscalationDeck } from './policies-activation-hub.mjs';
import { createActivationHubAnalyticsTimeline, createActivationHubForecastEnvelope, createActivationHubExceptionLedger, summarizeActivationHubAnalytics } from './analytics-activation-hub.mjs';
import { createActivationHubOperationsBoard, createActivationHubShiftChecklist, createActivationHubIncidentDeck } from './operations-activation-hub.mjs';
import { createActivationHubReportCards, createActivationHubReviewPackets, summarizeActivationHubReporting } from './reporting-activation-hub.mjs';
import { createActivationHubAuditTrail, createActivationHubEvidenceManifest, createActivationHubReadinessAttestation } from './audit-activation-hub.mjs';
import { createActivationHubPlaybooks, createActivationHubDecisionDeck, createActivationHubEscalationMoments } from './playbooks-activation-hub.mjs';

export function buildActivationHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationHubWorkspace(workspaceName);
  const policies = createActivationHubPolicies();
  return {
    workspace,
    summary: summarizeActivationHubWorkspace(workspace),
    narratives: createActivationHubNarratives(workspace),
    coverage: createActivationHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationHubPolicies(policies),
    validation: validateActivationHubPolicies(policies),
    escalationDeck: createActivationHubEscalationDeck(policies),
    analytics: {
      timeline: createActivationHubAnalyticsTimeline(),
      forecast: createActivationHubForecastEnvelope(),
      exceptions: createActivationHubExceptionLedger(),
      summary: summarizeActivationHubAnalytics()
    },
    operations: {
      board: createActivationHubOperationsBoard(),
      checklist: createActivationHubShiftChecklist(),
      incidents: createActivationHubIncidentDeck()
    },
    reporting: {
      cards: createActivationHubReportCards(),
      packets: createActivationHubReviewPackets(),
      summary: summarizeActivationHubReporting()
    },
    audit: {
      trail: createActivationHubAuditTrail(),
      manifest: createActivationHubEvidenceManifest(),
      attestation: createActivationHubReadinessAttestation()
    },
    playbooks: createActivationHubPlaybooks(),
    decisions: createActivationHubDecisionDeck(),
    escalationMoments: createActivationHubEscalationMoments()
  };
}

export function createActivationHubReadinessBoard(snapshot = buildActivationHubSnapshot()) {
  return [
    { id: 'activation-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationHubApiDocument(snapshot = buildActivationHubSnapshot()) {
  return {
    id: 'activation-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-hub/overview' },
      { method: 'GET', path: '/api/activation-hub/reporting' },
      { method: 'POST', path: '/api/activation-hub/validate' },
      { method: 'GET', path: '/api/activation-hub/audit' }
    ],
    readiness: createActivationHubReadinessBoard(snapshot)
  };
}

export function createActivationHubRouteSummary(snapshot = buildActivationHubSnapshot()) {
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

