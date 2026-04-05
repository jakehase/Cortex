import { createExperimentationAdvisorWorkspace, summarizeExperimentationAdvisorWorkspace, createExperimentationAdvisorNarratives, createExperimentationAdvisorCoverageGrid } from './domain-experimentation-advisor.mjs';
import { createExperimentationAdvisorPolicies, validateExperimentationAdvisorPolicies, summarizeExperimentationAdvisorPolicies, createExperimentationAdvisorEscalationDeck } from './policies-experimentation-advisor.mjs';
import { createExperimentationAdvisorAnalyticsTimeline, createExperimentationAdvisorForecastEnvelope, createExperimentationAdvisorExceptionLedger, summarizeExperimentationAdvisorAnalytics } from './analytics-experimentation-advisor.mjs';
import { createExperimentationAdvisorOperationsBoard, createExperimentationAdvisorShiftChecklist, createExperimentationAdvisorIncidentDeck } from './operations-experimentation-advisor.mjs';
import { createExperimentationAdvisorReportCards, createExperimentationAdvisorReviewPackets, summarizeExperimentationAdvisorReporting } from './reporting-experimentation-advisor.mjs';
import { createExperimentationAdvisorAuditTrail, createExperimentationAdvisorEvidenceManifest, createExperimentationAdvisorReadinessAttestation } from './audit-experimentation-advisor.mjs';
import { createExperimentationAdvisorPlaybooks, createExperimentationAdvisorDecisionDeck, createExperimentationAdvisorEscalationMoments } from './playbooks-experimentation-advisor.mjs';

export function buildExperimentationAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationAdvisorWorkspace(workspaceName);
  const policies = createExperimentationAdvisorPolicies();
  return {
    workspace,
    summary: summarizeExperimentationAdvisorWorkspace(workspace),
    narratives: createExperimentationAdvisorNarratives(workspace),
    coverage: createExperimentationAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationAdvisorPolicies(policies),
    validation: validateExperimentationAdvisorPolicies(policies),
    escalationDeck: createExperimentationAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationAdvisorAnalyticsTimeline(),
      forecast: createExperimentationAdvisorForecastEnvelope(),
      exceptions: createExperimentationAdvisorExceptionLedger(),
      summary: summarizeExperimentationAdvisorAnalytics()
    },
    operations: {
      board: createExperimentationAdvisorOperationsBoard(),
      checklist: createExperimentationAdvisorShiftChecklist(),
      incidents: createExperimentationAdvisorIncidentDeck()
    },
    reporting: {
      cards: createExperimentationAdvisorReportCards(),
      packets: createExperimentationAdvisorReviewPackets(),
      summary: summarizeExperimentationAdvisorReporting()
    },
    audit: {
      trail: createExperimentationAdvisorAuditTrail(),
      manifest: createExperimentationAdvisorEvidenceManifest(),
      attestation: createExperimentationAdvisorReadinessAttestation()
    },
    playbooks: createExperimentationAdvisorPlaybooks(),
    decisions: createExperimentationAdvisorDecisionDeck(),
    escalationMoments: createExperimentationAdvisorEscalationMoments()
  };
}

export function createExperimentationAdvisorReadinessBoard(snapshot = buildExperimentationAdvisorSnapshot()) {
  return [
    { id: 'experimentation-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationAdvisorApiDocument(snapshot = buildExperimentationAdvisorSnapshot()) {
  return {
    id: 'experimentation-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-advisor/overview' },
      { method: 'GET', path: '/api/experimentation-advisor/reporting' },
      { method: 'POST', path: '/api/experimentation-advisor/validate' },
      { method: 'GET', path: '/api/experimentation-advisor/audit' }
    ],
    readiness: createExperimentationAdvisorReadinessBoard(snapshot)
  };
}

export function createExperimentationAdvisorRouteSummary(snapshot = buildExperimentationAdvisorSnapshot()) {
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

