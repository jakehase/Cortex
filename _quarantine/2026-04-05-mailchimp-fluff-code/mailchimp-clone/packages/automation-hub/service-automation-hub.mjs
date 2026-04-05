import { createAutomationHubWorkspace, summarizeAutomationHubWorkspace, createAutomationHubNarratives, createAutomationHubCoverageGrid } from './domain-automation-hub.mjs';
import { createAutomationHubPolicies, validateAutomationHubPolicies, summarizeAutomationHubPolicies, createAutomationHubEscalationDeck } from './policies-automation-hub.mjs';
import { createAutomationHubAnalyticsTimeline, createAutomationHubForecastEnvelope, createAutomationHubExceptionLedger, summarizeAutomationHubAnalytics } from './analytics-automation-hub.mjs';
import { createAutomationHubOperationsBoard, createAutomationHubShiftChecklist, createAutomationHubIncidentDeck } from './operations-automation-hub.mjs';
import { createAutomationHubReportCards, createAutomationHubReviewPackets, summarizeAutomationHubReporting } from './reporting-automation-hub.mjs';
import { createAutomationHubAuditTrail, createAutomationHubEvidenceManifest, createAutomationHubReadinessAttestation } from './audit-automation-hub.mjs';
import { createAutomationHubPlaybooks, createAutomationHubDecisionDeck, createAutomationHubEscalationMoments } from './playbooks-automation-hub.mjs';

export function buildAutomationHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationHubWorkspace(workspaceName);
  const policies = createAutomationHubPolicies();
  return {
    workspace,
    summary: summarizeAutomationHubWorkspace(workspace),
    narratives: createAutomationHubNarratives(workspace),
    coverage: createAutomationHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationHubPolicies(policies),
    validation: validateAutomationHubPolicies(policies),
    escalationDeck: createAutomationHubEscalationDeck(policies),
    analytics: {
      timeline: createAutomationHubAnalyticsTimeline(),
      forecast: createAutomationHubForecastEnvelope(),
      exceptions: createAutomationHubExceptionLedger(),
      summary: summarizeAutomationHubAnalytics()
    },
    operations: {
      board: createAutomationHubOperationsBoard(),
      checklist: createAutomationHubShiftChecklist(),
      incidents: createAutomationHubIncidentDeck()
    },
    reporting: {
      cards: createAutomationHubReportCards(),
      packets: createAutomationHubReviewPackets(),
      summary: summarizeAutomationHubReporting()
    },
    audit: {
      trail: createAutomationHubAuditTrail(),
      manifest: createAutomationHubEvidenceManifest(),
      attestation: createAutomationHubReadinessAttestation()
    },
    playbooks: createAutomationHubPlaybooks(),
    decisions: createAutomationHubDecisionDeck(),
    escalationMoments: createAutomationHubEscalationMoments()
  };
}

export function createAutomationHubReadinessBoard(snapshot = buildAutomationHubSnapshot()) {
  return [
    { id: 'automation-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationHubApiDocument(snapshot = buildAutomationHubSnapshot()) {
  return {
    id: 'automation-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-hub/overview' },
      { method: 'GET', path: '/api/automation-hub/reporting' },
      { method: 'POST', path: '/api/automation-hub/validate' },
      { method: 'GET', path: '/api/automation-hub/audit' }
    ],
    readiness: createAutomationHubReadinessBoard(snapshot)
  };
}

export function createAutomationHubRouteSummary(snapshot = buildAutomationHubSnapshot()) {
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

