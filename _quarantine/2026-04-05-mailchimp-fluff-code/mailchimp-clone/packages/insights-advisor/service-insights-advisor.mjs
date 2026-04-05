import { createInsightsAdvisorWorkspace, summarizeInsightsAdvisorWorkspace, createInsightsAdvisorNarratives, createInsightsAdvisorCoverageGrid } from './domain-insights-advisor.mjs';
import { createInsightsAdvisorPolicies, validateInsightsAdvisorPolicies, summarizeInsightsAdvisorPolicies, createInsightsAdvisorEscalationDeck } from './policies-insights-advisor.mjs';
import { createInsightsAdvisorAnalyticsTimeline, createInsightsAdvisorForecastEnvelope, createInsightsAdvisorExceptionLedger, summarizeInsightsAdvisorAnalytics } from './analytics-insights-advisor.mjs';
import { createInsightsAdvisorOperationsBoard, createInsightsAdvisorShiftChecklist, createInsightsAdvisorIncidentDeck } from './operations-insights-advisor.mjs';
import { createInsightsAdvisorReportCards, createInsightsAdvisorReviewPackets, summarizeInsightsAdvisorReporting } from './reporting-insights-advisor.mjs';
import { createInsightsAdvisorAuditTrail, createInsightsAdvisorEvidenceManifest, createInsightsAdvisorReadinessAttestation } from './audit-insights-advisor.mjs';
import { createInsightsAdvisorPlaybooks, createInsightsAdvisorDecisionDeck, createInsightsAdvisorEscalationMoments } from './playbooks-insights-advisor.mjs';

export function buildInsightsAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsAdvisorWorkspace(workspaceName);
  const policies = createInsightsAdvisorPolicies();
  return {
    workspace,
    summary: summarizeInsightsAdvisorWorkspace(workspace),
    narratives: createInsightsAdvisorNarratives(workspace),
    coverage: createInsightsAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsAdvisorPolicies(policies),
    validation: validateInsightsAdvisorPolicies(policies),
    escalationDeck: createInsightsAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createInsightsAdvisorAnalyticsTimeline(),
      forecast: createInsightsAdvisorForecastEnvelope(),
      exceptions: createInsightsAdvisorExceptionLedger(),
      summary: summarizeInsightsAdvisorAnalytics()
    },
    operations: {
      board: createInsightsAdvisorOperationsBoard(),
      checklist: createInsightsAdvisorShiftChecklist(),
      incidents: createInsightsAdvisorIncidentDeck()
    },
    reporting: {
      cards: createInsightsAdvisorReportCards(),
      packets: createInsightsAdvisorReviewPackets(),
      summary: summarizeInsightsAdvisorReporting()
    },
    audit: {
      trail: createInsightsAdvisorAuditTrail(),
      manifest: createInsightsAdvisorEvidenceManifest(),
      attestation: createInsightsAdvisorReadinessAttestation()
    },
    playbooks: createInsightsAdvisorPlaybooks(),
    decisions: createInsightsAdvisorDecisionDeck(),
    escalationMoments: createInsightsAdvisorEscalationMoments()
  };
}

export function createInsightsAdvisorReadinessBoard(snapshot = buildInsightsAdvisorSnapshot()) {
  return [
    { id: 'insights-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsAdvisorApiDocument(snapshot = buildInsightsAdvisorSnapshot()) {
  return {
    id: 'insights-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-advisor/overview' },
      { method: 'GET', path: '/api/insights-advisor/reporting' },
      { method: 'POST', path: '/api/insights-advisor/validate' },
      { method: 'GET', path: '/api/insights-advisor/audit' }
    ],
    readiness: createInsightsAdvisorReadinessBoard(snapshot)
  };
}

export function createInsightsAdvisorRouteSummary(snapshot = buildInsightsAdvisorSnapshot()) {
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

