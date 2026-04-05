import { createAudienceWorkbenchWorkspace, summarizeAudienceWorkbenchWorkspace, createAudienceWorkbenchNarratives, createAudienceWorkbenchCoverageGrid } from './domain-audience-workbench.mjs';
import { createAudienceWorkbenchPolicies, validateAudienceWorkbenchPolicies, summarizeAudienceWorkbenchPolicies, createAudienceWorkbenchEscalationDeck } from './policies-audience-workbench.mjs';
import { createAudienceWorkbenchAnalyticsTimeline, createAudienceWorkbenchForecastEnvelope, createAudienceWorkbenchExceptionLedger, summarizeAudienceWorkbenchAnalytics } from './analytics-audience-workbench.mjs';
import { createAudienceWorkbenchOperationsBoard, createAudienceWorkbenchShiftChecklist, createAudienceWorkbenchIncidentDeck } from './operations-audience-workbench.mjs';
import { createAudienceWorkbenchReportCards, createAudienceWorkbenchReviewPackets, summarizeAudienceWorkbenchReporting } from './reporting-audience-workbench.mjs';
import { createAudienceWorkbenchAuditTrail, createAudienceWorkbenchEvidenceManifest, createAudienceWorkbenchReadinessAttestation } from './audit-audience-workbench.mjs';
import { createAudienceWorkbenchPlaybooks, createAudienceWorkbenchDecisionDeck, createAudienceWorkbenchEscalationMoments } from './playbooks-audience-workbench.mjs';

export function buildAudienceWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceWorkbenchWorkspace(workspaceName);
  const policies = createAudienceWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeAudienceWorkbenchWorkspace(workspace),
    narratives: createAudienceWorkbenchNarratives(workspace),
    coverage: createAudienceWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceWorkbenchPolicies(policies),
    validation: validateAudienceWorkbenchPolicies(policies),
    escalationDeck: createAudienceWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createAudienceWorkbenchAnalyticsTimeline(),
      forecast: createAudienceWorkbenchForecastEnvelope(),
      exceptions: createAudienceWorkbenchExceptionLedger(),
      summary: summarizeAudienceWorkbenchAnalytics()
    },
    operations: {
      board: createAudienceWorkbenchOperationsBoard(),
      checklist: createAudienceWorkbenchShiftChecklist(),
      incidents: createAudienceWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createAudienceWorkbenchReportCards(),
      packets: createAudienceWorkbenchReviewPackets(),
      summary: summarizeAudienceWorkbenchReporting()
    },
    audit: {
      trail: createAudienceWorkbenchAuditTrail(),
      manifest: createAudienceWorkbenchEvidenceManifest(),
      attestation: createAudienceWorkbenchReadinessAttestation()
    },
    playbooks: createAudienceWorkbenchPlaybooks(),
    decisions: createAudienceWorkbenchDecisionDeck(),
    escalationMoments: createAudienceWorkbenchEscalationMoments()
  };
}

export function createAudienceWorkbenchReadinessBoard(snapshot = buildAudienceWorkbenchSnapshot()) {
  return [
    { id: 'audience-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceWorkbenchApiDocument(snapshot = buildAudienceWorkbenchSnapshot()) {
  return {
    id: 'audience-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-workbench/overview' },
      { method: 'GET', path: '/api/audience-workbench/reporting' },
      { method: 'POST', path: '/api/audience-workbench/validate' },
      { method: 'GET', path: '/api/audience-workbench/audit' }
    ],
    readiness: createAudienceWorkbenchReadinessBoard(snapshot)
  };
}

export function createAudienceWorkbenchRouteSummary(snapshot = buildAudienceWorkbenchSnapshot()) {
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

