import { createExperimentationWorkbenchWorkspace, summarizeExperimentationWorkbenchWorkspace, createExperimentationWorkbenchNarratives, createExperimentationWorkbenchCoverageGrid } from './domain-experimentation-workbench.mjs';
import { createExperimentationWorkbenchPolicies, validateExperimentationWorkbenchPolicies, summarizeExperimentationWorkbenchPolicies, createExperimentationWorkbenchEscalationDeck } from './policies-experimentation-workbench.mjs';
import { createExperimentationWorkbenchAnalyticsTimeline, createExperimentationWorkbenchForecastEnvelope, createExperimentationWorkbenchExceptionLedger, summarizeExperimentationWorkbenchAnalytics } from './analytics-experimentation-workbench.mjs';
import { createExperimentationWorkbenchOperationsBoard, createExperimentationWorkbenchShiftChecklist, createExperimentationWorkbenchIncidentDeck } from './operations-experimentation-workbench.mjs';
import { createExperimentationWorkbenchReportCards, createExperimentationWorkbenchReviewPackets, summarizeExperimentationWorkbenchReporting } from './reporting-experimentation-workbench.mjs';
import { createExperimentationWorkbenchAuditTrail, createExperimentationWorkbenchEvidenceManifest, createExperimentationWorkbenchReadinessAttestation } from './audit-experimentation-workbench.mjs';
import { createExperimentationWorkbenchPlaybooks, createExperimentationWorkbenchDecisionDeck, createExperimentationWorkbenchEscalationMoments } from './playbooks-experimentation-workbench.mjs';

export function buildExperimentationWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationWorkbenchWorkspace(workspaceName);
  const policies = createExperimentationWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeExperimentationWorkbenchWorkspace(workspace),
    narratives: createExperimentationWorkbenchNarratives(workspace),
    coverage: createExperimentationWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationWorkbenchPolicies(policies),
    validation: validateExperimentationWorkbenchPolicies(policies),
    escalationDeck: createExperimentationWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationWorkbenchAnalyticsTimeline(),
      forecast: createExperimentationWorkbenchForecastEnvelope(),
      exceptions: createExperimentationWorkbenchExceptionLedger(),
      summary: summarizeExperimentationWorkbenchAnalytics()
    },
    operations: {
      board: createExperimentationWorkbenchOperationsBoard(),
      checklist: createExperimentationWorkbenchShiftChecklist(),
      incidents: createExperimentationWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createExperimentationWorkbenchReportCards(),
      packets: createExperimentationWorkbenchReviewPackets(),
      summary: summarizeExperimentationWorkbenchReporting()
    },
    audit: {
      trail: createExperimentationWorkbenchAuditTrail(),
      manifest: createExperimentationWorkbenchEvidenceManifest(),
      attestation: createExperimentationWorkbenchReadinessAttestation()
    },
    playbooks: createExperimentationWorkbenchPlaybooks(),
    decisions: createExperimentationWorkbenchDecisionDeck(),
    escalationMoments: createExperimentationWorkbenchEscalationMoments()
  };
}

export function createExperimentationWorkbenchReadinessBoard(snapshot = buildExperimentationWorkbenchSnapshot()) {
  return [
    { id: 'experimentation-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationWorkbenchApiDocument(snapshot = buildExperimentationWorkbenchSnapshot()) {
  return {
    id: 'experimentation-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-workbench/overview' },
      { method: 'GET', path: '/api/experimentation-workbench/reporting' },
      { method: 'POST', path: '/api/experimentation-workbench/validate' },
      { method: 'GET', path: '/api/experimentation-workbench/audit' }
    ],
    readiness: createExperimentationWorkbenchReadinessBoard(snapshot)
  };
}

export function createExperimentationWorkbenchRouteSummary(snapshot = buildExperimentationWorkbenchSnapshot()) {
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

