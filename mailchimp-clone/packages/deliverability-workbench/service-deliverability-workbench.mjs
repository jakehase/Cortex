import { createDeliverabilityWorkbenchWorkspace, summarizeDeliverabilityWorkbenchWorkspace, createDeliverabilityWorkbenchNarratives, createDeliverabilityWorkbenchCoverageGrid } from './domain-deliverability-workbench.mjs';
import { createDeliverabilityWorkbenchPolicies, validateDeliverabilityWorkbenchPolicies, summarizeDeliverabilityWorkbenchPolicies, createDeliverabilityWorkbenchEscalationDeck } from './policies-deliverability-workbench.mjs';
import { createDeliverabilityWorkbenchAnalyticsTimeline, createDeliverabilityWorkbenchForecastEnvelope, createDeliverabilityWorkbenchExceptionLedger, summarizeDeliverabilityWorkbenchAnalytics } from './analytics-deliverability-workbench.mjs';
import { createDeliverabilityWorkbenchOperationsBoard, createDeliverabilityWorkbenchShiftChecklist, createDeliverabilityWorkbenchIncidentDeck } from './operations-deliverability-workbench.mjs';
import { createDeliverabilityWorkbenchReportCards, createDeliverabilityWorkbenchReviewPackets, summarizeDeliverabilityWorkbenchReporting } from './reporting-deliverability-workbench.mjs';
import { createDeliverabilityWorkbenchAuditTrail, createDeliverabilityWorkbenchEvidenceManifest, createDeliverabilityWorkbenchReadinessAttestation } from './audit-deliverability-workbench.mjs';
import { createDeliverabilityWorkbenchPlaybooks, createDeliverabilityWorkbenchDecisionDeck, createDeliverabilityWorkbenchEscalationMoments } from './playbooks-deliverability-workbench.mjs';

export function buildDeliverabilityWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityWorkbenchWorkspace(workspaceName);
  const policies = createDeliverabilityWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityWorkbenchWorkspace(workspace),
    narratives: createDeliverabilityWorkbenchNarratives(workspace),
    coverage: createDeliverabilityWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityWorkbenchPolicies(policies),
    validation: validateDeliverabilityWorkbenchPolicies(policies),
    escalationDeck: createDeliverabilityWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityWorkbenchAnalyticsTimeline(),
      forecast: createDeliverabilityWorkbenchForecastEnvelope(),
      exceptions: createDeliverabilityWorkbenchExceptionLedger(),
      summary: summarizeDeliverabilityWorkbenchAnalytics()
    },
    operations: {
      board: createDeliverabilityWorkbenchOperationsBoard(),
      checklist: createDeliverabilityWorkbenchShiftChecklist(),
      incidents: createDeliverabilityWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityWorkbenchReportCards(),
      packets: createDeliverabilityWorkbenchReviewPackets(),
      summary: summarizeDeliverabilityWorkbenchReporting()
    },
    audit: {
      trail: createDeliverabilityWorkbenchAuditTrail(),
      manifest: createDeliverabilityWorkbenchEvidenceManifest(),
      attestation: createDeliverabilityWorkbenchReadinessAttestation()
    },
    playbooks: createDeliverabilityWorkbenchPlaybooks(),
    decisions: createDeliverabilityWorkbenchDecisionDeck(),
    escalationMoments: createDeliverabilityWorkbenchEscalationMoments()
  };
}

export function createDeliverabilityWorkbenchReadinessBoard(snapshot = buildDeliverabilityWorkbenchSnapshot()) {
  return [
    { id: 'deliverability-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityWorkbenchApiDocument(snapshot = buildDeliverabilityWorkbenchSnapshot()) {
  return {
    id: 'deliverability-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-workbench/overview' },
      { method: 'GET', path: '/api/deliverability-workbench/reporting' },
      { method: 'POST', path: '/api/deliverability-workbench/validate' },
      { method: 'GET', path: '/api/deliverability-workbench/audit' }
    ],
    readiness: createDeliverabilityWorkbenchReadinessBoard(snapshot)
  };
}

export function createDeliverabilityWorkbenchRouteSummary(snapshot = buildDeliverabilityWorkbenchSnapshot()) {
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

