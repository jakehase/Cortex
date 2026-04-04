import { createDataAdvisorWorkspace, summarizeDataAdvisorWorkspace, createDataAdvisorNarratives, createDataAdvisorCoverageGrid } from './domain-data-advisor.mjs';
import { createDataAdvisorPolicies, validateDataAdvisorPolicies, summarizeDataAdvisorPolicies, createDataAdvisorEscalationDeck } from './policies-data-advisor.mjs';
import { createDataAdvisorAnalyticsTimeline, createDataAdvisorForecastEnvelope, createDataAdvisorExceptionLedger, summarizeDataAdvisorAnalytics } from './analytics-data-advisor.mjs';
import { createDataAdvisorOperationsBoard, createDataAdvisorShiftChecklist, createDataAdvisorIncidentDeck } from './operations-data-advisor.mjs';
import { createDataAdvisorReportCards, createDataAdvisorReviewPackets, summarizeDataAdvisorReporting } from './reporting-data-advisor.mjs';
import { createDataAdvisorAuditTrail, createDataAdvisorEvidenceManifest, createDataAdvisorReadinessAttestation } from './audit-data-advisor.mjs';
import { createDataAdvisorPlaybooks, createDataAdvisorDecisionDeck, createDataAdvisorEscalationMoments } from './playbooks-data-advisor.mjs';

export function buildDataAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataAdvisorWorkspace(workspaceName);
  const policies = createDataAdvisorPolicies();
  return {
    workspace,
    summary: summarizeDataAdvisorWorkspace(workspace),
    narratives: createDataAdvisorNarratives(workspace),
    coverage: createDataAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataAdvisorPolicies(policies),
    validation: validateDataAdvisorPolicies(policies),
    escalationDeck: createDataAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createDataAdvisorAnalyticsTimeline(),
      forecast: createDataAdvisorForecastEnvelope(),
      exceptions: createDataAdvisorExceptionLedger(),
      summary: summarizeDataAdvisorAnalytics()
    },
    operations: {
      board: createDataAdvisorOperationsBoard(),
      checklist: createDataAdvisorShiftChecklist(),
      incidents: createDataAdvisorIncidentDeck()
    },
    reporting: {
      cards: createDataAdvisorReportCards(),
      packets: createDataAdvisorReviewPackets(),
      summary: summarizeDataAdvisorReporting()
    },
    audit: {
      trail: createDataAdvisorAuditTrail(),
      manifest: createDataAdvisorEvidenceManifest(),
      attestation: createDataAdvisorReadinessAttestation()
    },
    playbooks: createDataAdvisorPlaybooks(),
    decisions: createDataAdvisorDecisionDeck(),
    escalationMoments: createDataAdvisorEscalationMoments()
  };
}

export function createDataAdvisorReadinessBoard(snapshot = buildDataAdvisorSnapshot()) {
  return [
    { id: 'data-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataAdvisorApiDocument(snapshot = buildDataAdvisorSnapshot()) {
  return {
    id: 'data-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-advisor/overview' },
      { method: 'GET', path: '/api/data-advisor/reporting' },
      { method: 'POST', path: '/api/data-advisor/validate' },
      { method: 'GET', path: '/api/data-advisor/audit' }
    ],
    readiness: createDataAdvisorReadinessBoard(snapshot)
  };
}

export function createDataAdvisorRouteSummary(snapshot = buildDataAdvisorSnapshot()) {
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

