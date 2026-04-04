import { createAnalyticsAdvisorWorkspace, summarizeAnalyticsAdvisorWorkspace, createAnalyticsAdvisorNarratives, createAnalyticsAdvisorCoverageGrid } from './domain-analytics-advisor.mjs';
import { createAnalyticsAdvisorPolicies, validateAnalyticsAdvisorPolicies, summarizeAnalyticsAdvisorPolicies, createAnalyticsAdvisorEscalationDeck } from './policies-analytics-advisor.mjs';
import { createAnalyticsAdvisorAnalyticsTimeline, createAnalyticsAdvisorForecastEnvelope, createAnalyticsAdvisorExceptionLedger, summarizeAnalyticsAdvisorAnalytics } from './analytics-analytics-advisor.mjs';
import { createAnalyticsAdvisorOperationsBoard, createAnalyticsAdvisorShiftChecklist, createAnalyticsAdvisorIncidentDeck } from './operations-analytics-advisor.mjs';
import { createAnalyticsAdvisorReportCards, createAnalyticsAdvisorReviewPackets, summarizeAnalyticsAdvisorReporting } from './reporting-analytics-advisor.mjs';
import { createAnalyticsAdvisorAuditTrail, createAnalyticsAdvisorEvidenceManifest, createAnalyticsAdvisorReadinessAttestation } from './audit-analytics-advisor.mjs';
import { createAnalyticsAdvisorPlaybooks, createAnalyticsAdvisorDecisionDeck, createAnalyticsAdvisorEscalationMoments } from './playbooks-analytics-advisor.mjs';

export function buildAnalyticsAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsAdvisorWorkspace(workspaceName);
  const policies = createAnalyticsAdvisorPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsAdvisorWorkspace(workspace),
    narratives: createAnalyticsAdvisorNarratives(workspace),
    coverage: createAnalyticsAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsAdvisorPolicies(policies),
    validation: validateAnalyticsAdvisorPolicies(policies),
    escalationDeck: createAnalyticsAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsAdvisorAnalyticsTimeline(),
      forecast: createAnalyticsAdvisorForecastEnvelope(),
      exceptions: createAnalyticsAdvisorExceptionLedger(),
      summary: summarizeAnalyticsAdvisorAnalytics()
    },
    operations: {
      board: createAnalyticsAdvisorOperationsBoard(),
      checklist: createAnalyticsAdvisorShiftChecklist(),
      incidents: createAnalyticsAdvisorIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsAdvisorReportCards(),
      packets: createAnalyticsAdvisorReviewPackets(),
      summary: summarizeAnalyticsAdvisorReporting()
    },
    audit: {
      trail: createAnalyticsAdvisorAuditTrail(),
      manifest: createAnalyticsAdvisorEvidenceManifest(),
      attestation: createAnalyticsAdvisorReadinessAttestation()
    },
    playbooks: createAnalyticsAdvisorPlaybooks(),
    decisions: createAnalyticsAdvisorDecisionDeck(),
    escalationMoments: createAnalyticsAdvisorEscalationMoments()
  };
}

export function createAnalyticsAdvisorReadinessBoard(snapshot = buildAnalyticsAdvisorSnapshot()) {
  return [
    { id: 'analytics-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsAdvisorApiDocument(snapshot = buildAnalyticsAdvisorSnapshot()) {
  return {
    id: 'analytics-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-advisor/overview' },
      { method: 'GET', path: '/api/analytics-advisor/reporting' },
      { method: 'POST', path: '/api/analytics-advisor/validate' },
      { method: 'GET', path: '/api/analytics-advisor/audit' }
    ],
    readiness: createAnalyticsAdvisorReadinessBoard(snapshot)
  };
}

export function createAnalyticsAdvisorRouteSummary(snapshot = buildAnalyticsAdvisorSnapshot()) {
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

