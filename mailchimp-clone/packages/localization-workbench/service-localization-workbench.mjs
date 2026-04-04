import { createLocalizationWorkbenchWorkspace, summarizeLocalizationWorkbenchWorkspace, createLocalizationWorkbenchNarratives, createLocalizationWorkbenchCoverageGrid } from './domain-localization-workbench.mjs';
import { createLocalizationWorkbenchPolicies, validateLocalizationWorkbenchPolicies, summarizeLocalizationWorkbenchPolicies, createLocalizationWorkbenchEscalationDeck } from './policies-localization-workbench.mjs';
import { createLocalizationWorkbenchAnalyticsTimeline, createLocalizationWorkbenchForecastEnvelope, createLocalizationWorkbenchExceptionLedger, summarizeLocalizationWorkbenchAnalytics } from './analytics-localization-workbench.mjs';
import { createLocalizationWorkbenchOperationsBoard, createLocalizationWorkbenchShiftChecklist, createLocalizationWorkbenchIncidentDeck } from './operations-localization-workbench.mjs';
import { createLocalizationWorkbenchReportCards, createLocalizationWorkbenchReviewPackets, summarizeLocalizationWorkbenchReporting } from './reporting-localization-workbench.mjs';
import { createLocalizationWorkbenchAuditTrail, createLocalizationWorkbenchEvidenceManifest, createLocalizationWorkbenchReadinessAttestation } from './audit-localization-workbench.mjs';
import { createLocalizationWorkbenchPlaybooks, createLocalizationWorkbenchDecisionDeck, createLocalizationWorkbenchEscalationMoments } from './playbooks-localization-workbench.mjs';

export function buildLocalizationWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationWorkbenchWorkspace(workspaceName);
  const policies = createLocalizationWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeLocalizationWorkbenchWorkspace(workspace),
    narratives: createLocalizationWorkbenchNarratives(workspace),
    coverage: createLocalizationWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationWorkbenchPolicies(policies),
    validation: validateLocalizationWorkbenchPolicies(policies),
    escalationDeck: createLocalizationWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationWorkbenchAnalyticsTimeline(),
      forecast: createLocalizationWorkbenchForecastEnvelope(),
      exceptions: createLocalizationWorkbenchExceptionLedger(),
      summary: summarizeLocalizationWorkbenchAnalytics()
    },
    operations: {
      board: createLocalizationWorkbenchOperationsBoard(),
      checklist: createLocalizationWorkbenchShiftChecklist(),
      incidents: createLocalizationWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createLocalizationWorkbenchReportCards(),
      packets: createLocalizationWorkbenchReviewPackets(),
      summary: summarizeLocalizationWorkbenchReporting()
    },
    audit: {
      trail: createLocalizationWorkbenchAuditTrail(),
      manifest: createLocalizationWorkbenchEvidenceManifest(),
      attestation: createLocalizationWorkbenchReadinessAttestation()
    },
    playbooks: createLocalizationWorkbenchPlaybooks(),
    decisions: createLocalizationWorkbenchDecisionDeck(),
    escalationMoments: createLocalizationWorkbenchEscalationMoments()
  };
}

export function createLocalizationWorkbenchReadinessBoard(snapshot = buildLocalizationWorkbenchSnapshot()) {
  return [
    { id: 'localization-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationWorkbenchApiDocument(snapshot = buildLocalizationWorkbenchSnapshot()) {
  return {
    id: 'localization-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-workbench/overview' },
      { method: 'GET', path: '/api/localization-workbench/reporting' },
      { method: 'POST', path: '/api/localization-workbench/validate' },
      { method: 'GET', path: '/api/localization-workbench/audit' }
    ],
    readiness: createLocalizationWorkbenchReadinessBoard(snapshot)
  };
}

export function createLocalizationWorkbenchRouteSummary(snapshot = buildLocalizationWorkbenchSnapshot()) {
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

