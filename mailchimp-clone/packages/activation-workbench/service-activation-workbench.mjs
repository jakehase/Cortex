import { createActivationWorkbenchWorkspace, summarizeActivationWorkbenchWorkspace, createActivationWorkbenchNarratives, createActivationWorkbenchCoverageGrid } from './domain-activation-workbench.mjs';
import { createActivationWorkbenchPolicies, validateActivationWorkbenchPolicies, summarizeActivationWorkbenchPolicies, createActivationWorkbenchEscalationDeck } from './policies-activation-workbench.mjs';
import { createActivationWorkbenchAnalyticsTimeline, createActivationWorkbenchForecastEnvelope, createActivationWorkbenchExceptionLedger, summarizeActivationWorkbenchAnalytics } from './analytics-activation-workbench.mjs';
import { createActivationWorkbenchOperationsBoard, createActivationWorkbenchShiftChecklist, createActivationWorkbenchIncidentDeck } from './operations-activation-workbench.mjs';
import { createActivationWorkbenchReportCards, createActivationWorkbenchReviewPackets, summarizeActivationWorkbenchReporting } from './reporting-activation-workbench.mjs';
import { createActivationWorkbenchAuditTrail, createActivationWorkbenchEvidenceManifest, createActivationWorkbenchReadinessAttestation } from './audit-activation-workbench.mjs';
import { createActivationWorkbenchPlaybooks, createActivationWorkbenchDecisionDeck, createActivationWorkbenchEscalationMoments } from './playbooks-activation-workbench.mjs';

export function buildActivationWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationWorkbenchWorkspace(workspaceName);
  const policies = createActivationWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeActivationWorkbenchWorkspace(workspace),
    narratives: createActivationWorkbenchNarratives(workspace),
    coverage: createActivationWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationWorkbenchPolicies(policies),
    validation: validateActivationWorkbenchPolicies(policies),
    escalationDeck: createActivationWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createActivationWorkbenchAnalyticsTimeline(),
      forecast: createActivationWorkbenchForecastEnvelope(),
      exceptions: createActivationWorkbenchExceptionLedger(),
      summary: summarizeActivationWorkbenchAnalytics()
    },
    operations: {
      board: createActivationWorkbenchOperationsBoard(),
      checklist: createActivationWorkbenchShiftChecklist(),
      incidents: createActivationWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createActivationWorkbenchReportCards(),
      packets: createActivationWorkbenchReviewPackets(),
      summary: summarizeActivationWorkbenchReporting()
    },
    audit: {
      trail: createActivationWorkbenchAuditTrail(),
      manifest: createActivationWorkbenchEvidenceManifest(),
      attestation: createActivationWorkbenchReadinessAttestation()
    },
    playbooks: createActivationWorkbenchPlaybooks(),
    decisions: createActivationWorkbenchDecisionDeck(),
    escalationMoments: createActivationWorkbenchEscalationMoments()
  };
}

export function createActivationWorkbenchReadinessBoard(snapshot = buildActivationWorkbenchSnapshot()) {
  return [
    { id: 'activation-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationWorkbenchApiDocument(snapshot = buildActivationWorkbenchSnapshot()) {
  return {
    id: 'activation-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-workbench/overview' },
      { method: 'GET', path: '/api/activation-workbench/reporting' },
      { method: 'POST', path: '/api/activation-workbench/validate' },
      { method: 'GET', path: '/api/activation-workbench/audit' }
    ],
    readiness: createActivationWorkbenchReadinessBoard(snapshot)
  };
}

export function createActivationWorkbenchRouteSummary(snapshot = buildActivationWorkbenchSnapshot()) {
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

