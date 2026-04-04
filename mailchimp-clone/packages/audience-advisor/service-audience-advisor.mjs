import { createAudienceAdvisorWorkspace, summarizeAudienceAdvisorWorkspace, createAudienceAdvisorNarratives, createAudienceAdvisorCoverageGrid } from './domain-audience-advisor.mjs';
import { createAudienceAdvisorPolicies, validateAudienceAdvisorPolicies, summarizeAudienceAdvisorPolicies, createAudienceAdvisorEscalationDeck } from './policies-audience-advisor.mjs';
import { createAudienceAdvisorAnalyticsTimeline, createAudienceAdvisorForecastEnvelope, createAudienceAdvisorExceptionLedger, summarizeAudienceAdvisorAnalytics } from './analytics-audience-advisor.mjs';
import { createAudienceAdvisorOperationsBoard, createAudienceAdvisorShiftChecklist, createAudienceAdvisorIncidentDeck } from './operations-audience-advisor.mjs';
import { createAudienceAdvisorReportCards, createAudienceAdvisorReviewPackets, summarizeAudienceAdvisorReporting } from './reporting-audience-advisor.mjs';
import { createAudienceAdvisorAuditTrail, createAudienceAdvisorEvidenceManifest, createAudienceAdvisorReadinessAttestation } from './audit-audience-advisor.mjs';
import { createAudienceAdvisorPlaybooks, createAudienceAdvisorDecisionDeck, createAudienceAdvisorEscalationMoments } from './playbooks-audience-advisor.mjs';

export function buildAudienceAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceAdvisorWorkspace(workspaceName);
  const policies = createAudienceAdvisorPolicies();
  return {
    workspace,
    summary: summarizeAudienceAdvisorWorkspace(workspace),
    narratives: createAudienceAdvisorNarratives(workspace),
    coverage: createAudienceAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceAdvisorPolicies(policies),
    validation: validateAudienceAdvisorPolicies(policies),
    escalationDeck: createAudienceAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createAudienceAdvisorAnalyticsTimeline(),
      forecast: createAudienceAdvisorForecastEnvelope(),
      exceptions: createAudienceAdvisorExceptionLedger(),
      summary: summarizeAudienceAdvisorAnalytics()
    },
    operations: {
      board: createAudienceAdvisorOperationsBoard(),
      checklist: createAudienceAdvisorShiftChecklist(),
      incidents: createAudienceAdvisorIncidentDeck()
    },
    reporting: {
      cards: createAudienceAdvisorReportCards(),
      packets: createAudienceAdvisorReviewPackets(),
      summary: summarizeAudienceAdvisorReporting()
    },
    audit: {
      trail: createAudienceAdvisorAuditTrail(),
      manifest: createAudienceAdvisorEvidenceManifest(),
      attestation: createAudienceAdvisorReadinessAttestation()
    },
    playbooks: createAudienceAdvisorPlaybooks(),
    decisions: createAudienceAdvisorDecisionDeck(),
    escalationMoments: createAudienceAdvisorEscalationMoments()
  };
}

export function createAudienceAdvisorReadinessBoard(snapshot = buildAudienceAdvisorSnapshot()) {
  return [
    { id: 'audience-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceAdvisorApiDocument(snapshot = buildAudienceAdvisorSnapshot()) {
  return {
    id: 'audience-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-advisor/overview' },
      { method: 'GET', path: '/api/audience-advisor/reporting' },
      { method: 'POST', path: '/api/audience-advisor/validate' },
      { method: 'GET', path: '/api/audience-advisor/audit' }
    ],
    readiness: createAudienceAdvisorReadinessBoard(snapshot)
  };
}

export function createAudienceAdvisorRouteSummary(snapshot = buildAudienceAdvisorSnapshot()) {
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

