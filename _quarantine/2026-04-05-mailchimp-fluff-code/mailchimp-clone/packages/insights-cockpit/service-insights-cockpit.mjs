import { createInsightsCockpitWorkspace, summarizeInsightsCockpitWorkspace, createInsightsCockpitNarratives, createInsightsCockpitCoverageGrid } from './domain-insights-cockpit.mjs';
import { createInsightsCockpitPolicies, validateInsightsCockpitPolicies, summarizeInsightsCockpitPolicies, createInsightsCockpitEscalationDeck } from './policies-insights-cockpit.mjs';
import { createInsightsCockpitAnalyticsTimeline, createInsightsCockpitForecastEnvelope, createInsightsCockpitExceptionLedger, summarizeInsightsCockpitAnalytics } from './analytics-insights-cockpit.mjs';
import { createInsightsCockpitOperationsBoard, createInsightsCockpitShiftChecklist, createInsightsCockpitIncidentDeck } from './operations-insights-cockpit.mjs';
import { createInsightsCockpitReportCards, createInsightsCockpitReviewPackets, summarizeInsightsCockpitReporting } from './reporting-insights-cockpit.mjs';
import { createInsightsCockpitAuditTrail, createInsightsCockpitEvidenceManifest, createInsightsCockpitReadinessAttestation } from './audit-insights-cockpit.mjs';
import { createInsightsCockpitPlaybooks, createInsightsCockpitDecisionDeck, createInsightsCockpitEscalationMoments } from './playbooks-insights-cockpit.mjs';

export function buildInsightsCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsCockpitWorkspace(workspaceName);
  const policies = createInsightsCockpitPolicies();
  return {
    workspace,
    summary: summarizeInsightsCockpitWorkspace(workspace),
    narratives: createInsightsCockpitNarratives(workspace),
    coverage: createInsightsCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsCockpitPolicies(policies),
    validation: validateInsightsCockpitPolicies(policies),
    escalationDeck: createInsightsCockpitEscalationDeck(policies),
    analytics: {
      timeline: createInsightsCockpitAnalyticsTimeline(),
      forecast: createInsightsCockpitForecastEnvelope(),
      exceptions: createInsightsCockpitExceptionLedger(),
      summary: summarizeInsightsCockpitAnalytics()
    },
    operations: {
      board: createInsightsCockpitOperationsBoard(),
      checklist: createInsightsCockpitShiftChecklist(),
      incidents: createInsightsCockpitIncidentDeck()
    },
    reporting: {
      cards: createInsightsCockpitReportCards(),
      packets: createInsightsCockpitReviewPackets(),
      summary: summarizeInsightsCockpitReporting()
    },
    audit: {
      trail: createInsightsCockpitAuditTrail(),
      manifest: createInsightsCockpitEvidenceManifest(),
      attestation: createInsightsCockpitReadinessAttestation()
    },
    playbooks: createInsightsCockpitPlaybooks(),
    decisions: createInsightsCockpitDecisionDeck(),
    escalationMoments: createInsightsCockpitEscalationMoments()
  };
}

export function createInsightsCockpitReadinessBoard(snapshot = buildInsightsCockpitSnapshot()) {
  return [
    { id: 'insights-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsCockpitApiDocument(snapshot = buildInsightsCockpitSnapshot()) {
  return {
    id: 'insights-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-cockpit/overview' },
      { method: 'GET', path: '/api/insights-cockpit/reporting' },
      { method: 'POST', path: '/api/insights-cockpit/validate' },
      { method: 'GET', path: '/api/insights-cockpit/audit' }
    ],
    readiness: createInsightsCockpitReadinessBoard(snapshot)
  };
}

export function createInsightsCockpitRouteSummary(snapshot = buildInsightsCockpitSnapshot()) {
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

