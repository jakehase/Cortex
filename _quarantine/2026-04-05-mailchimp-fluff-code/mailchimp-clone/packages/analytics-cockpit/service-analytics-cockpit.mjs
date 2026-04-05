import { createAnalyticsCockpitWorkspace, summarizeAnalyticsCockpitWorkspace, createAnalyticsCockpitNarratives, createAnalyticsCockpitCoverageGrid } from './domain-analytics-cockpit.mjs';
import { createAnalyticsCockpitPolicies, validateAnalyticsCockpitPolicies, summarizeAnalyticsCockpitPolicies, createAnalyticsCockpitEscalationDeck } from './policies-analytics-cockpit.mjs';
import { createAnalyticsCockpitAnalyticsTimeline, createAnalyticsCockpitForecastEnvelope, createAnalyticsCockpitExceptionLedger, summarizeAnalyticsCockpitAnalytics } from './analytics-analytics-cockpit.mjs';
import { createAnalyticsCockpitOperationsBoard, createAnalyticsCockpitShiftChecklist, createAnalyticsCockpitIncidentDeck } from './operations-analytics-cockpit.mjs';
import { createAnalyticsCockpitReportCards, createAnalyticsCockpitReviewPackets, summarizeAnalyticsCockpitReporting } from './reporting-analytics-cockpit.mjs';
import { createAnalyticsCockpitAuditTrail, createAnalyticsCockpitEvidenceManifest, createAnalyticsCockpitReadinessAttestation } from './audit-analytics-cockpit.mjs';
import { createAnalyticsCockpitPlaybooks, createAnalyticsCockpitDecisionDeck, createAnalyticsCockpitEscalationMoments } from './playbooks-analytics-cockpit.mjs';

export function buildAnalyticsCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsCockpitWorkspace(workspaceName);
  const policies = createAnalyticsCockpitPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsCockpitWorkspace(workspace),
    narratives: createAnalyticsCockpitNarratives(workspace),
    coverage: createAnalyticsCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsCockpitPolicies(policies),
    validation: validateAnalyticsCockpitPolicies(policies),
    escalationDeck: createAnalyticsCockpitEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsCockpitAnalyticsTimeline(),
      forecast: createAnalyticsCockpitForecastEnvelope(),
      exceptions: createAnalyticsCockpitExceptionLedger(),
      summary: summarizeAnalyticsCockpitAnalytics()
    },
    operations: {
      board: createAnalyticsCockpitOperationsBoard(),
      checklist: createAnalyticsCockpitShiftChecklist(),
      incidents: createAnalyticsCockpitIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsCockpitReportCards(),
      packets: createAnalyticsCockpitReviewPackets(),
      summary: summarizeAnalyticsCockpitReporting()
    },
    audit: {
      trail: createAnalyticsCockpitAuditTrail(),
      manifest: createAnalyticsCockpitEvidenceManifest(),
      attestation: createAnalyticsCockpitReadinessAttestation()
    },
    playbooks: createAnalyticsCockpitPlaybooks(),
    decisions: createAnalyticsCockpitDecisionDeck(),
    escalationMoments: createAnalyticsCockpitEscalationMoments()
  };
}

export function createAnalyticsCockpitReadinessBoard(snapshot = buildAnalyticsCockpitSnapshot()) {
  return [
    { id: 'analytics-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsCockpitApiDocument(snapshot = buildAnalyticsCockpitSnapshot()) {
  return {
    id: 'analytics-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-cockpit/overview' },
      { method: 'GET', path: '/api/analytics-cockpit/reporting' },
      { method: 'POST', path: '/api/analytics-cockpit/validate' },
      { method: 'GET', path: '/api/analytics-cockpit/audit' }
    ],
    readiness: createAnalyticsCockpitReadinessBoard(snapshot)
  };
}

export function createAnalyticsCockpitRouteSummary(snapshot = buildAnalyticsCockpitSnapshot()) {
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

