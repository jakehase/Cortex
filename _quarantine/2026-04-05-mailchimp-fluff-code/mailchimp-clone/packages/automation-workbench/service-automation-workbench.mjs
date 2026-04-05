import { createAutomationWorkbenchWorkspace, summarizeAutomationWorkbenchWorkspace, createAutomationWorkbenchNarratives, createAutomationWorkbenchCoverageGrid } from './domain-automation-workbench.mjs';
import { createAutomationWorkbenchPolicies, validateAutomationWorkbenchPolicies, summarizeAutomationWorkbenchPolicies, createAutomationWorkbenchEscalationDeck } from './policies-automation-workbench.mjs';
import { createAutomationWorkbenchAnalyticsTimeline, createAutomationWorkbenchForecastEnvelope, createAutomationWorkbenchExceptionLedger, summarizeAutomationWorkbenchAnalytics } from './analytics-automation-workbench.mjs';
import { createAutomationWorkbenchOperationsBoard, createAutomationWorkbenchShiftChecklist, createAutomationWorkbenchIncidentDeck } from './operations-automation-workbench.mjs';
import { createAutomationWorkbenchReportCards, createAutomationWorkbenchReviewPackets, summarizeAutomationWorkbenchReporting } from './reporting-automation-workbench.mjs';
import { createAutomationWorkbenchAuditTrail, createAutomationWorkbenchEvidenceManifest, createAutomationWorkbenchReadinessAttestation } from './audit-automation-workbench.mjs';
import { createAutomationWorkbenchPlaybooks, createAutomationWorkbenchDecisionDeck, createAutomationWorkbenchEscalationMoments } from './playbooks-automation-workbench.mjs';

export function buildAutomationWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationWorkbenchWorkspace(workspaceName);
  const policies = createAutomationWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeAutomationWorkbenchWorkspace(workspace),
    narratives: createAutomationWorkbenchNarratives(workspace),
    coverage: createAutomationWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationWorkbenchPolicies(policies),
    validation: validateAutomationWorkbenchPolicies(policies),
    escalationDeck: createAutomationWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createAutomationWorkbenchAnalyticsTimeline(),
      forecast: createAutomationWorkbenchForecastEnvelope(),
      exceptions: createAutomationWorkbenchExceptionLedger(),
      summary: summarizeAutomationWorkbenchAnalytics()
    },
    operations: {
      board: createAutomationWorkbenchOperationsBoard(),
      checklist: createAutomationWorkbenchShiftChecklist(),
      incidents: createAutomationWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createAutomationWorkbenchReportCards(),
      packets: createAutomationWorkbenchReviewPackets(),
      summary: summarizeAutomationWorkbenchReporting()
    },
    audit: {
      trail: createAutomationWorkbenchAuditTrail(),
      manifest: createAutomationWorkbenchEvidenceManifest(),
      attestation: createAutomationWorkbenchReadinessAttestation()
    },
    playbooks: createAutomationWorkbenchPlaybooks(),
    decisions: createAutomationWorkbenchDecisionDeck(),
    escalationMoments: createAutomationWorkbenchEscalationMoments()
  };
}

export function createAutomationWorkbenchReadinessBoard(snapshot = buildAutomationWorkbenchSnapshot()) {
  return [
    { id: 'automation-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationWorkbenchApiDocument(snapshot = buildAutomationWorkbenchSnapshot()) {
  return {
    id: 'automation-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-workbench/overview' },
      { method: 'GET', path: '/api/automation-workbench/reporting' },
      { method: 'POST', path: '/api/automation-workbench/validate' },
      { method: 'GET', path: '/api/automation-workbench/audit' }
    ],
    readiness: createAutomationWorkbenchReadinessBoard(snapshot)
  };
}

export function createAutomationWorkbenchRouteSummary(snapshot = buildAutomationWorkbenchSnapshot()) {
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

