import { createAdvocacyWorkbenchWorkspace, summarizeAdvocacyWorkbenchWorkspace, createAdvocacyWorkbenchNarratives, createAdvocacyWorkbenchCoverageGrid } from './domain-advocacy-workbench.mjs';
import { createAdvocacyWorkbenchPolicies, validateAdvocacyWorkbenchPolicies, summarizeAdvocacyWorkbenchPolicies, createAdvocacyWorkbenchEscalationDeck } from './policies-advocacy-workbench.mjs';
import { createAdvocacyWorkbenchAnalyticsTimeline, createAdvocacyWorkbenchForecastEnvelope, createAdvocacyWorkbenchExceptionLedger, summarizeAdvocacyWorkbenchAnalytics } from './analytics-advocacy-workbench.mjs';
import { createAdvocacyWorkbenchOperationsBoard, createAdvocacyWorkbenchShiftChecklist, createAdvocacyWorkbenchIncidentDeck } from './operations-advocacy-workbench.mjs';
import { createAdvocacyWorkbenchReportCards, createAdvocacyWorkbenchReviewPackets, summarizeAdvocacyWorkbenchReporting } from './reporting-advocacy-workbench.mjs';
import { createAdvocacyWorkbenchAuditTrail, createAdvocacyWorkbenchEvidenceManifest, createAdvocacyWorkbenchReadinessAttestation } from './audit-advocacy-workbench.mjs';
import { createAdvocacyWorkbenchPlaybooks, createAdvocacyWorkbenchDecisionDeck, createAdvocacyWorkbenchEscalationMoments } from './playbooks-advocacy-workbench.mjs';

export function buildAdvocacyWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyWorkbenchWorkspace(workspaceName);
  const policies = createAdvocacyWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyWorkbenchWorkspace(workspace),
    narratives: createAdvocacyWorkbenchNarratives(workspace),
    coverage: createAdvocacyWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyWorkbenchPolicies(policies),
    validation: validateAdvocacyWorkbenchPolicies(policies),
    escalationDeck: createAdvocacyWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyWorkbenchAnalyticsTimeline(),
      forecast: createAdvocacyWorkbenchForecastEnvelope(),
      exceptions: createAdvocacyWorkbenchExceptionLedger(),
      summary: summarizeAdvocacyWorkbenchAnalytics()
    },
    operations: {
      board: createAdvocacyWorkbenchOperationsBoard(),
      checklist: createAdvocacyWorkbenchShiftChecklist(),
      incidents: createAdvocacyWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyWorkbenchReportCards(),
      packets: createAdvocacyWorkbenchReviewPackets(),
      summary: summarizeAdvocacyWorkbenchReporting()
    },
    audit: {
      trail: createAdvocacyWorkbenchAuditTrail(),
      manifest: createAdvocacyWorkbenchEvidenceManifest(),
      attestation: createAdvocacyWorkbenchReadinessAttestation()
    },
    playbooks: createAdvocacyWorkbenchPlaybooks(),
    decisions: createAdvocacyWorkbenchDecisionDeck(),
    escalationMoments: createAdvocacyWorkbenchEscalationMoments()
  };
}

export function createAdvocacyWorkbenchReadinessBoard(snapshot = buildAdvocacyWorkbenchSnapshot()) {
  return [
    { id: 'advocacy-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyWorkbenchApiDocument(snapshot = buildAdvocacyWorkbenchSnapshot()) {
  return {
    id: 'advocacy-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-workbench/overview' },
      { method: 'GET', path: '/api/advocacy-workbench/reporting' },
      { method: 'POST', path: '/api/advocacy-workbench/validate' },
      { method: 'GET', path: '/api/advocacy-workbench/audit' }
    ],
    readiness: createAdvocacyWorkbenchReadinessBoard(snapshot)
  };
}

export function createAdvocacyWorkbenchRouteSummary(snapshot = buildAdvocacyWorkbenchSnapshot()) {
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

