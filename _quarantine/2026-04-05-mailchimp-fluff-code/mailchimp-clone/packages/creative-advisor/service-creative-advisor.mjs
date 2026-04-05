import { createCreativeAdvisorWorkspace, summarizeCreativeAdvisorWorkspace, createCreativeAdvisorNarratives, createCreativeAdvisorCoverageGrid } from './domain-creative-advisor.mjs';
import { createCreativeAdvisorPolicies, validateCreativeAdvisorPolicies, summarizeCreativeAdvisorPolicies, createCreativeAdvisorEscalationDeck } from './policies-creative-advisor.mjs';
import { createCreativeAdvisorAnalyticsTimeline, createCreativeAdvisorForecastEnvelope, createCreativeAdvisorExceptionLedger, summarizeCreativeAdvisorAnalytics } from './analytics-creative-advisor.mjs';
import { createCreativeAdvisorOperationsBoard, createCreativeAdvisorShiftChecklist, createCreativeAdvisorIncidentDeck } from './operations-creative-advisor.mjs';
import { createCreativeAdvisorReportCards, createCreativeAdvisorReviewPackets, summarizeCreativeAdvisorReporting } from './reporting-creative-advisor.mjs';
import { createCreativeAdvisorAuditTrail, createCreativeAdvisorEvidenceManifest, createCreativeAdvisorReadinessAttestation } from './audit-creative-advisor.mjs';
import { createCreativeAdvisorPlaybooks, createCreativeAdvisorDecisionDeck, createCreativeAdvisorEscalationMoments } from './playbooks-creative-advisor.mjs';

export function buildCreativeAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeAdvisorWorkspace(workspaceName);
  const policies = createCreativeAdvisorPolicies();
  return {
    workspace,
    summary: summarizeCreativeAdvisorWorkspace(workspace),
    narratives: createCreativeAdvisorNarratives(workspace),
    coverage: createCreativeAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeAdvisorPolicies(policies),
    validation: validateCreativeAdvisorPolicies(policies),
    escalationDeck: createCreativeAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createCreativeAdvisorAnalyticsTimeline(),
      forecast: createCreativeAdvisorForecastEnvelope(),
      exceptions: createCreativeAdvisorExceptionLedger(),
      summary: summarizeCreativeAdvisorAnalytics()
    },
    operations: {
      board: createCreativeAdvisorOperationsBoard(),
      checklist: createCreativeAdvisorShiftChecklist(),
      incidents: createCreativeAdvisorIncidentDeck()
    },
    reporting: {
      cards: createCreativeAdvisorReportCards(),
      packets: createCreativeAdvisorReviewPackets(),
      summary: summarizeCreativeAdvisorReporting()
    },
    audit: {
      trail: createCreativeAdvisorAuditTrail(),
      manifest: createCreativeAdvisorEvidenceManifest(),
      attestation: createCreativeAdvisorReadinessAttestation()
    },
    playbooks: createCreativeAdvisorPlaybooks(),
    decisions: createCreativeAdvisorDecisionDeck(),
    escalationMoments: createCreativeAdvisorEscalationMoments()
  };
}

export function createCreativeAdvisorReadinessBoard(snapshot = buildCreativeAdvisorSnapshot()) {
  return [
    { id: 'creative-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeAdvisorApiDocument(snapshot = buildCreativeAdvisorSnapshot()) {
  return {
    id: 'creative-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-advisor/overview' },
      { method: 'GET', path: '/api/creative-advisor/reporting' },
      { method: 'POST', path: '/api/creative-advisor/validate' },
      { method: 'GET', path: '/api/creative-advisor/audit' }
    ],
    readiness: createCreativeAdvisorReadinessBoard(snapshot)
  };
}

export function createCreativeAdvisorRouteSummary(snapshot = buildCreativeAdvisorSnapshot()) {
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

