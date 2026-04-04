import { createActivationAdvisorWorkspace, summarizeActivationAdvisorWorkspace, createActivationAdvisorNarratives, createActivationAdvisorCoverageGrid } from './domain-activation-advisor.mjs';
import { createActivationAdvisorPolicies, validateActivationAdvisorPolicies, summarizeActivationAdvisorPolicies, createActivationAdvisorEscalationDeck } from './policies-activation-advisor.mjs';
import { createActivationAdvisorAnalyticsTimeline, createActivationAdvisorForecastEnvelope, createActivationAdvisorExceptionLedger, summarizeActivationAdvisorAnalytics } from './analytics-activation-advisor.mjs';
import { createActivationAdvisorOperationsBoard, createActivationAdvisorShiftChecklist, createActivationAdvisorIncidentDeck } from './operations-activation-advisor.mjs';
import { createActivationAdvisorReportCards, createActivationAdvisorReviewPackets, summarizeActivationAdvisorReporting } from './reporting-activation-advisor.mjs';
import { createActivationAdvisorAuditTrail, createActivationAdvisorEvidenceManifest, createActivationAdvisorReadinessAttestation } from './audit-activation-advisor.mjs';
import { createActivationAdvisorPlaybooks, createActivationAdvisorDecisionDeck, createActivationAdvisorEscalationMoments } from './playbooks-activation-advisor.mjs';

export function buildActivationAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationAdvisorWorkspace(workspaceName);
  const policies = createActivationAdvisorPolicies();
  return {
    workspace,
    summary: summarizeActivationAdvisorWorkspace(workspace),
    narratives: createActivationAdvisorNarratives(workspace),
    coverage: createActivationAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationAdvisorPolicies(policies),
    validation: validateActivationAdvisorPolicies(policies),
    escalationDeck: createActivationAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createActivationAdvisorAnalyticsTimeline(),
      forecast: createActivationAdvisorForecastEnvelope(),
      exceptions: createActivationAdvisorExceptionLedger(),
      summary: summarizeActivationAdvisorAnalytics()
    },
    operations: {
      board: createActivationAdvisorOperationsBoard(),
      checklist: createActivationAdvisorShiftChecklist(),
      incidents: createActivationAdvisorIncidentDeck()
    },
    reporting: {
      cards: createActivationAdvisorReportCards(),
      packets: createActivationAdvisorReviewPackets(),
      summary: summarizeActivationAdvisorReporting()
    },
    audit: {
      trail: createActivationAdvisorAuditTrail(),
      manifest: createActivationAdvisorEvidenceManifest(),
      attestation: createActivationAdvisorReadinessAttestation()
    },
    playbooks: createActivationAdvisorPlaybooks(),
    decisions: createActivationAdvisorDecisionDeck(),
    escalationMoments: createActivationAdvisorEscalationMoments()
  };
}

export function createActivationAdvisorReadinessBoard(snapshot = buildActivationAdvisorSnapshot()) {
  return [
    { id: 'activation-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationAdvisorApiDocument(snapshot = buildActivationAdvisorSnapshot()) {
  return {
    id: 'activation-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-advisor/overview' },
      { method: 'GET', path: '/api/activation-advisor/reporting' },
      { method: 'POST', path: '/api/activation-advisor/validate' },
      { method: 'GET', path: '/api/activation-advisor/audit' }
    ],
    readiness: createActivationAdvisorReadinessBoard(snapshot)
  };
}

export function createActivationAdvisorRouteSummary(snapshot = buildActivationAdvisorSnapshot()) {
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

