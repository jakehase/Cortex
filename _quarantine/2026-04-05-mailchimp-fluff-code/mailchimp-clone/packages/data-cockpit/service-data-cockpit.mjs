import { createDataCockpitWorkspace, summarizeDataCockpitWorkspace, createDataCockpitNarratives, createDataCockpitCoverageGrid } from './domain-data-cockpit.mjs';
import { createDataCockpitPolicies, validateDataCockpitPolicies, summarizeDataCockpitPolicies, createDataCockpitEscalationDeck } from './policies-data-cockpit.mjs';
import { createDataCockpitAnalyticsTimeline, createDataCockpitForecastEnvelope, createDataCockpitExceptionLedger, summarizeDataCockpitAnalytics } from './analytics-data-cockpit.mjs';
import { createDataCockpitOperationsBoard, createDataCockpitShiftChecklist, createDataCockpitIncidentDeck } from './operations-data-cockpit.mjs';
import { createDataCockpitReportCards, createDataCockpitReviewPackets, summarizeDataCockpitReporting } from './reporting-data-cockpit.mjs';
import { createDataCockpitAuditTrail, createDataCockpitEvidenceManifest, createDataCockpitReadinessAttestation } from './audit-data-cockpit.mjs';
import { createDataCockpitPlaybooks, createDataCockpitDecisionDeck, createDataCockpitEscalationMoments } from './playbooks-data-cockpit.mjs';

export function buildDataCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataCockpitWorkspace(workspaceName);
  const policies = createDataCockpitPolicies();
  return {
    workspace,
    summary: summarizeDataCockpitWorkspace(workspace),
    narratives: createDataCockpitNarratives(workspace),
    coverage: createDataCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataCockpitPolicies(policies),
    validation: validateDataCockpitPolicies(policies),
    escalationDeck: createDataCockpitEscalationDeck(policies),
    analytics: {
      timeline: createDataCockpitAnalyticsTimeline(),
      forecast: createDataCockpitForecastEnvelope(),
      exceptions: createDataCockpitExceptionLedger(),
      summary: summarizeDataCockpitAnalytics()
    },
    operations: {
      board: createDataCockpitOperationsBoard(),
      checklist: createDataCockpitShiftChecklist(),
      incidents: createDataCockpitIncidentDeck()
    },
    reporting: {
      cards: createDataCockpitReportCards(),
      packets: createDataCockpitReviewPackets(),
      summary: summarizeDataCockpitReporting()
    },
    audit: {
      trail: createDataCockpitAuditTrail(),
      manifest: createDataCockpitEvidenceManifest(),
      attestation: createDataCockpitReadinessAttestation()
    },
    playbooks: createDataCockpitPlaybooks(),
    decisions: createDataCockpitDecisionDeck(),
    escalationMoments: createDataCockpitEscalationMoments()
  };
}

export function createDataCockpitReadinessBoard(snapshot = buildDataCockpitSnapshot()) {
  return [
    { id: 'data-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataCockpitApiDocument(snapshot = buildDataCockpitSnapshot()) {
  return {
    id: 'data-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-cockpit/overview' },
      { method: 'GET', path: '/api/data-cockpit/reporting' },
      { method: 'POST', path: '/api/data-cockpit/validate' },
      { method: 'GET', path: '/api/data-cockpit/audit' }
    ],
    readiness: createDataCockpitReadinessBoard(snapshot)
  };
}

export function createDataCockpitRouteSummary(snapshot = buildDataCockpitSnapshot()) {
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

