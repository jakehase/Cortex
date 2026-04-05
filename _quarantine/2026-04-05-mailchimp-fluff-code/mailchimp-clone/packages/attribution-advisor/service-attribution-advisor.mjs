import { createAttributionAdvisorWorkspace, summarizeAttributionAdvisorWorkspace, createAttributionAdvisorNarratives, createAttributionAdvisorCoverageGrid } from './domain-attribution-advisor.mjs';
import { createAttributionAdvisorPolicies, validateAttributionAdvisorPolicies, summarizeAttributionAdvisorPolicies, createAttributionAdvisorEscalationDeck } from './policies-attribution-advisor.mjs';
import { createAttributionAdvisorAnalyticsTimeline, createAttributionAdvisorForecastEnvelope, createAttributionAdvisorExceptionLedger, summarizeAttributionAdvisorAnalytics } from './analytics-attribution-advisor.mjs';
import { createAttributionAdvisorOperationsBoard, createAttributionAdvisorShiftChecklist, createAttributionAdvisorIncidentDeck } from './operations-attribution-advisor.mjs';
import { createAttributionAdvisorReportCards, createAttributionAdvisorReviewPackets, summarizeAttributionAdvisorReporting } from './reporting-attribution-advisor.mjs';
import { createAttributionAdvisorAuditTrail, createAttributionAdvisorEvidenceManifest, createAttributionAdvisorReadinessAttestation } from './audit-attribution-advisor.mjs';
import { createAttributionAdvisorPlaybooks, createAttributionAdvisorDecisionDeck, createAttributionAdvisorEscalationMoments } from './playbooks-attribution-advisor.mjs';

export function buildAttributionAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionAdvisorWorkspace(workspaceName);
  const policies = createAttributionAdvisorPolicies();
  return {
    workspace,
    summary: summarizeAttributionAdvisorWorkspace(workspace),
    narratives: createAttributionAdvisorNarratives(workspace),
    coverage: createAttributionAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionAdvisorPolicies(policies),
    validation: validateAttributionAdvisorPolicies(policies),
    escalationDeck: createAttributionAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createAttributionAdvisorAnalyticsTimeline(),
      forecast: createAttributionAdvisorForecastEnvelope(),
      exceptions: createAttributionAdvisorExceptionLedger(),
      summary: summarizeAttributionAdvisorAnalytics()
    },
    operations: {
      board: createAttributionAdvisorOperationsBoard(),
      checklist: createAttributionAdvisorShiftChecklist(),
      incidents: createAttributionAdvisorIncidentDeck()
    },
    reporting: {
      cards: createAttributionAdvisorReportCards(),
      packets: createAttributionAdvisorReviewPackets(),
      summary: summarizeAttributionAdvisorReporting()
    },
    audit: {
      trail: createAttributionAdvisorAuditTrail(),
      manifest: createAttributionAdvisorEvidenceManifest(),
      attestation: createAttributionAdvisorReadinessAttestation()
    },
    playbooks: createAttributionAdvisorPlaybooks(),
    decisions: createAttributionAdvisorDecisionDeck(),
    escalationMoments: createAttributionAdvisorEscalationMoments()
  };
}

export function createAttributionAdvisorReadinessBoard(snapshot = buildAttributionAdvisorSnapshot()) {
  return [
    { id: 'attribution-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionAdvisorApiDocument(snapshot = buildAttributionAdvisorSnapshot()) {
  return {
    id: 'attribution-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-advisor/overview' },
      { method: 'GET', path: '/api/attribution-advisor/reporting' },
      { method: 'POST', path: '/api/attribution-advisor/validate' },
      { method: 'GET', path: '/api/attribution-advisor/audit' }
    ],
    readiness: createAttributionAdvisorReadinessBoard(snapshot)
  };
}

export function createAttributionAdvisorRouteSummary(snapshot = buildAttributionAdvisorSnapshot()) {
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

