import { createIntegrationsHubWorkspace, summarizeIntegrationsHubWorkspace, createIntegrationsHubNarratives, createIntegrationsHubCoverageGrid } from './domain-integrations-hub.mjs';
import { createIntegrationsHubPolicies, validateIntegrationsHubPolicies, summarizeIntegrationsHubPolicies, createIntegrationsHubEscalationDeck } from './policies-integrations-hub.mjs';
import { createIntegrationsHubAnalyticsTimeline, createIntegrationsHubForecastEnvelope, createIntegrationsHubExceptionLedger, summarizeIntegrationsHubAnalytics } from './analytics-integrations-hub.mjs';
import { createIntegrationsHubOperationsBoard, createIntegrationsHubShiftChecklist, createIntegrationsHubIncidentDeck } from './operations-integrations-hub.mjs';
import { createIntegrationsHubReportCards, createIntegrationsHubReviewPackets, summarizeIntegrationsHubReporting } from './reporting-integrations-hub.mjs';
import { createIntegrationsHubAuditTrail, createIntegrationsHubEvidenceManifest, createIntegrationsHubReadinessAttestation } from './audit-integrations-hub.mjs';
import { createIntegrationsHubPlaybooks, createIntegrationsHubDecisionDeck, createIntegrationsHubEscalationMoments } from './playbooks-integrations-hub.mjs';

export function buildIntegrationsHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsHubWorkspace(workspaceName);
  const policies = createIntegrationsHubPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsHubWorkspace(workspace),
    narratives: createIntegrationsHubNarratives(workspace),
    coverage: createIntegrationsHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsHubPolicies(policies),
    validation: validateIntegrationsHubPolicies(policies),
    escalationDeck: createIntegrationsHubEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsHubAnalyticsTimeline(),
      forecast: createIntegrationsHubForecastEnvelope(),
      exceptions: createIntegrationsHubExceptionLedger(),
      summary: summarizeIntegrationsHubAnalytics()
    },
    operations: {
      board: createIntegrationsHubOperationsBoard(),
      checklist: createIntegrationsHubShiftChecklist(),
      incidents: createIntegrationsHubIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsHubReportCards(),
      packets: createIntegrationsHubReviewPackets(),
      summary: summarizeIntegrationsHubReporting()
    },
    audit: {
      trail: createIntegrationsHubAuditTrail(),
      manifest: createIntegrationsHubEvidenceManifest(),
      attestation: createIntegrationsHubReadinessAttestation()
    },
    playbooks: createIntegrationsHubPlaybooks(),
    decisions: createIntegrationsHubDecisionDeck(),
    escalationMoments: createIntegrationsHubEscalationMoments()
  };
}

export function createIntegrationsHubReadinessBoard(snapshot = buildIntegrationsHubSnapshot()) {
  return [
    { id: 'integrations-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsHubApiDocument(snapshot = buildIntegrationsHubSnapshot()) {
  return {
    id: 'integrations-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-hub/overview' },
      { method: 'GET', path: '/api/integrations-hub/reporting' },
      { method: 'POST', path: '/api/integrations-hub/validate' },
      { method: 'GET', path: '/api/integrations-hub/audit' }
    ],
    readiness: createIntegrationsHubReadinessBoard(snapshot)
  };
}

export function createIntegrationsHubRouteSummary(snapshot = buildIntegrationsHubSnapshot()) {
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

