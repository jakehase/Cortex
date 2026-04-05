import { createIntegrationsWorkbenchWorkspace, summarizeIntegrationsWorkbenchWorkspace, createIntegrationsWorkbenchNarratives, createIntegrationsWorkbenchCoverageGrid } from './domain-integrations-workbench.mjs';
import { createIntegrationsWorkbenchPolicies, validateIntegrationsWorkbenchPolicies, summarizeIntegrationsWorkbenchPolicies, createIntegrationsWorkbenchEscalationDeck } from './policies-integrations-workbench.mjs';
import { createIntegrationsWorkbenchAnalyticsTimeline, createIntegrationsWorkbenchForecastEnvelope, createIntegrationsWorkbenchExceptionLedger, summarizeIntegrationsWorkbenchAnalytics } from './analytics-integrations-workbench.mjs';
import { createIntegrationsWorkbenchOperationsBoard, createIntegrationsWorkbenchShiftChecklist, createIntegrationsWorkbenchIncidentDeck } from './operations-integrations-workbench.mjs';
import { createIntegrationsWorkbenchReportCards, createIntegrationsWorkbenchReviewPackets, summarizeIntegrationsWorkbenchReporting } from './reporting-integrations-workbench.mjs';
import { createIntegrationsWorkbenchAuditTrail, createIntegrationsWorkbenchEvidenceManifest, createIntegrationsWorkbenchReadinessAttestation } from './audit-integrations-workbench.mjs';
import { createIntegrationsWorkbenchPlaybooks, createIntegrationsWorkbenchDecisionDeck, createIntegrationsWorkbenchEscalationMoments } from './playbooks-integrations-workbench.mjs';

export function buildIntegrationsWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsWorkbenchWorkspace(workspaceName);
  const policies = createIntegrationsWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsWorkbenchWorkspace(workspace),
    narratives: createIntegrationsWorkbenchNarratives(workspace),
    coverage: createIntegrationsWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsWorkbenchPolicies(policies),
    validation: validateIntegrationsWorkbenchPolicies(policies),
    escalationDeck: createIntegrationsWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsWorkbenchAnalyticsTimeline(),
      forecast: createIntegrationsWorkbenchForecastEnvelope(),
      exceptions: createIntegrationsWorkbenchExceptionLedger(),
      summary: summarizeIntegrationsWorkbenchAnalytics()
    },
    operations: {
      board: createIntegrationsWorkbenchOperationsBoard(),
      checklist: createIntegrationsWorkbenchShiftChecklist(),
      incidents: createIntegrationsWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsWorkbenchReportCards(),
      packets: createIntegrationsWorkbenchReviewPackets(),
      summary: summarizeIntegrationsWorkbenchReporting()
    },
    audit: {
      trail: createIntegrationsWorkbenchAuditTrail(),
      manifest: createIntegrationsWorkbenchEvidenceManifest(),
      attestation: createIntegrationsWorkbenchReadinessAttestation()
    },
    playbooks: createIntegrationsWorkbenchPlaybooks(),
    decisions: createIntegrationsWorkbenchDecisionDeck(),
    escalationMoments: createIntegrationsWorkbenchEscalationMoments()
  };
}

export function createIntegrationsWorkbenchReadinessBoard(snapshot = buildIntegrationsWorkbenchSnapshot()) {
  return [
    { id: 'integrations-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsWorkbenchApiDocument(snapshot = buildIntegrationsWorkbenchSnapshot()) {
  return {
    id: 'integrations-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-workbench/overview' },
      { method: 'GET', path: '/api/integrations-workbench/reporting' },
      { method: 'POST', path: '/api/integrations-workbench/validate' },
      { method: 'GET', path: '/api/integrations-workbench/audit' }
    ],
    readiness: createIntegrationsWorkbenchReadinessBoard(snapshot)
  };
}

export function createIntegrationsWorkbenchRouteSummary(snapshot = buildIntegrationsWorkbenchSnapshot()) {
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

