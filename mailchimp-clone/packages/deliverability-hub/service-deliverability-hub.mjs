import { createDeliverabilityHubWorkspace, summarizeDeliverabilityHubWorkspace, createDeliverabilityHubNarratives, createDeliverabilityHubCoverageGrid } from './domain-deliverability-hub.mjs';
import { createDeliverabilityHubPolicies, validateDeliverabilityHubPolicies, summarizeDeliverabilityHubPolicies, createDeliverabilityHubEscalationDeck } from './policies-deliverability-hub.mjs';
import { createDeliverabilityHubAnalyticsTimeline, createDeliverabilityHubForecastEnvelope, createDeliverabilityHubExceptionLedger, summarizeDeliverabilityHubAnalytics } from './analytics-deliverability-hub.mjs';
import { createDeliverabilityHubOperationsBoard, createDeliverabilityHubShiftChecklist, createDeliverabilityHubIncidentDeck } from './operations-deliverability-hub.mjs';
import { createDeliverabilityHubReportCards, createDeliverabilityHubReviewPackets, summarizeDeliverabilityHubReporting } from './reporting-deliverability-hub.mjs';
import { createDeliverabilityHubAuditTrail, createDeliverabilityHubEvidenceManifest, createDeliverabilityHubReadinessAttestation } from './audit-deliverability-hub.mjs';
import { createDeliverabilityHubPlaybooks, createDeliverabilityHubDecisionDeck, createDeliverabilityHubEscalationMoments } from './playbooks-deliverability-hub.mjs';

export function buildDeliverabilityHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityHubWorkspace(workspaceName);
  const policies = createDeliverabilityHubPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityHubWorkspace(workspace),
    narratives: createDeliverabilityHubNarratives(workspace),
    coverage: createDeliverabilityHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityHubPolicies(policies),
    validation: validateDeliverabilityHubPolicies(policies),
    escalationDeck: createDeliverabilityHubEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityHubAnalyticsTimeline(),
      forecast: createDeliverabilityHubForecastEnvelope(),
      exceptions: createDeliverabilityHubExceptionLedger(),
      summary: summarizeDeliverabilityHubAnalytics()
    },
    operations: {
      board: createDeliverabilityHubOperationsBoard(),
      checklist: createDeliverabilityHubShiftChecklist(),
      incidents: createDeliverabilityHubIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityHubReportCards(),
      packets: createDeliverabilityHubReviewPackets(),
      summary: summarizeDeliverabilityHubReporting()
    },
    audit: {
      trail: createDeliverabilityHubAuditTrail(),
      manifest: createDeliverabilityHubEvidenceManifest(),
      attestation: createDeliverabilityHubReadinessAttestation()
    },
    playbooks: createDeliverabilityHubPlaybooks(),
    decisions: createDeliverabilityHubDecisionDeck(),
    escalationMoments: createDeliverabilityHubEscalationMoments()
  };
}

export function createDeliverabilityHubReadinessBoard(snapshot = buildDeliverabilityHubSnapshot()) {
  return [
    { id: 'deliverability-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityHubApiDocument(snapshot = buildDeliverabilityHubSnapshot()) {
  return {
    id: 'deliverability-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-hub/overview' },
      { method: 'GET', path: '/api/deliverability-hub/reporting' },
      { method: 'POST', path: '/api/deliverability-hub/validate' },
      { method: 'GET', path: '/api/deliverability-hub/audit' }
    ],
    readiness: createDeliverabilityHubReadinessBoard(snapshot)
  };
}

export function createDeliverabilityHubRouteSummary(snapshot = buildDeliverabilityHubSnapshot()) {
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

