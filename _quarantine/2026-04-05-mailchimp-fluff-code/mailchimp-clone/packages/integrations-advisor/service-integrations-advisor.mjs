import { createIntegrationsAdvisorWorkspace, summarizeIntegrationsAdvisorWorkspace, createIntegrationsAdvisorNarratives, createIntegrationsAdvisorCoverageGrid } from './domain-integrations-advisor.mjs';
import { createIntegrationsAdvisorPolicies, validateIntegrationsAdvisorPolicies, summarizeIntegrationsAdvisorPolicies, createIntegrationsAdvisorEscalationDeck } from './policies-integrations-advisor.mjs';
import { createIntegrationsAdvisorAnalyticsTimeline, createIntegrationsAdvisorForecastEnvelope, createIntegrationsAdvisorExceptionLedger, summarizeIntegrationsAdvisorAnalytics } from './analytics-integrations-advisor.mjs';
import { createIntegrationsAdvisorOperationsBoard, createIntegrationsAdvisorShiftChecklist, createIntegrationsAdvisorIncidentDeck } from './operations-integrations-advisor.mjs';
import { createIntegrationsAdvisorReportCards, createIntegrationsAdvisorReviewPackets, summarizeIntegrationsAdvisorReporting } from './reporting-integrations-advisor.mjs';
import { createIntegrationsAdvisorAuditTrail, createIntegrationsAdvisorEvidenceManifest, createIntegrationsAdvisorReadinessAttestation } from './audit-integrations-advisor.mjs';
import { createIntegrationsAdvisorPlaybooks, createIntegrationsAdvisorDecisionDeck, createIntegrationsAdvisorEscalationMoments } from './playbooks-integrations-advisor.mjs';

export function buildIntegrationsAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsAdvisorWorkspace(workspaceName);
  const policies = createIntegrationsAdvisorPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsAdvisorWorkspace(workspace),
    narratives: createIntegrationsAdvisorNarratives(workspace),
    coverage: createIntegrationsAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsAdvisorPolicies(policies),
    validation: validateIntegrationsAdvisorPolicies(policies),
    escalationDeck: createIntegrationsAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsAdvisorAnalyticsTimeline(),
      forecast: createIntegrationsAdvisorForecastEnvelope(),
      exceptions: createIntegrationsAdvisorExceptionLedger(),
      summary: summarizeIntegrationsAdvisorAnalytics()
    },
    operations: {
      board: createIntegrationsAdvisorOperationsBoard(),
      checklist: createIntegrationsAdvisorShiftChecklist(),
      incidents: createIntegrationsAdvisorIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsAdvisorReportCards(),
      packets: createIntegrationsAdvisorReviewPackets(),
      summary: summarizeIntegrationsAdvisorReporting()
    },
    audit: {
      trail: createIntegrationsAdvisorAuditTrail(),
      manifest: createIntegrationsAdvisorEvidenceManifest(),
      attestation: createIntegrationsAdvisorReadinessAttestation()
    },
    playbooks: createIntegrationsAdvisorPlaybooks(),
    decisions: createIntegrationsAdvisorDecisionDeck(),
    escalationMoments: createIntegrationsAdvisorEscalationMoments()
  };
}

export function createIntegrationsAdvisorReadinessBoard(snapshot = buildIntegrationsAdvisorSnapshot()) {
  return [
    { id: 'integrations-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsAdvisorApiDocument(snapshot = buildIntegrationsAdvisorSnapshot()) {
  return {
    id: 'integrations-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-advisor/overview' },
      { method: 'GET', path: '/api/integrations-advisor/reporting' },
      { method: 'POST', path: '/api/integrations-advisor/validate' },
      { method: 'GET', path: '/api/integrations-advisor/audit' }
    ],
    readiness: createIntegrationsAdvisorReadinessBoard(snapshot)
  };
}

export function createIntegrationsAdvisorRouteSummary(snapshot = buildIntegrationsAdvisorSnapshot()) {
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

