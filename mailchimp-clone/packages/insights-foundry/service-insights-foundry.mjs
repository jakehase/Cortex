import { createInsightsFoundryWorkspace, summarizeInsightsFoundryWorkspace, createInsightsFoundryNarratives, createInsightsFoundryCoverageGrid } from './domain-insights-foundry.mjs';
import { createInsightsFoundryPolicies, validateInsightsFoundryPolicies, summarizeInsightsFoundryPolicies, createInsightsFoundryEscalationDeck } from './policies-insights-foundry.mjs';
import { createInsightsFoundryAnalyticsTimeline, createInsightsFoundryForecastEnvelope, createInsightsFoundryExceptionLedger, summarizeInsightsFoundryAnalytics } from './analytics-insights-foundry.mjs';
import { createInsightsFoundryOperationsBoard, createInsightsFoundryShiftChecklist, createInsightsFoundryIncidentDeck } from './operations-insights-foundry.mjs';
import { createInsightsFoundryReportCards, createInsightsFoundryReviewPackets, summarizeInsightsFoundryReporting } from './reporting-insights-foundry.mjs';
import { createInsightsFoundryAuditTrail, createInsightsFoundryEvidenceManifest, createInsightsFoundryReadinessAttestation } from './audit-insights-foundry.mjs';
import { createInsightsFoundryPlaybooks, createInsightsFoundryDecisionDeck, createInsightsFoundryEscalationMoments } from './playbooks-insights-foundry.mjs';

export function buildInsightsFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsFoundryWorkspace(workspaceName);
  const policies = createInsightsFoundryPolicies();
  return {
    workspace,
    summary: summarizeInsightsFoundryWorkspace(workspace),
    narratives: createInsightsFoundryNarratives(workspace),
    coverage: createInsightsFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsFoundryPolicies(policies),
    validation: validateInsightsFoundryPolicies(policies),
    escalationDeck: createInsightsFoundryEscalationDeck(policies),
    analytics: {
      timeline: createInsightsFoundryAnalyticsTimeline(),
      forecast: createInsightsFoundryForecastEnvelope(),
      exceptions: createInsightsFoundryExceptionLedger(),
      summary: summarizeInsightsFoundryAnalytics()
    },
    operations: {
      board: createInsightsFoundryOperationsBoard(),
      checklist: createInsightsFoundryShiftChecklist(),
      incidents: createInsightsFoundryIncidentDeck()
    },
    reporting: {
      cards: createInsightsFoundryReportCards(),
      packets: createInsightsFoundryReviewPackets(),
      summary: summarizeInsightsFoundryReporting()
    },
    audit: {
      trail: createInsightsFoundryAuditTrail(),
      manifest: createInsightsFoundryEvidenceManifest(),
      attestation: createInsightsFoundryReadinessAttestation()
    },
    playbooks: createInsightsFoundryPlaybooks(),
    decisions: createInsightsFoundryDecisionDeck(),
    escalationMoments: createInsightsFoundryEscalationMoments()
  };
}

export function createInsightsFoundryReadinessBoard(snapshot = buildInsightsFoundrySnapshot()) {
  return [
    { id: 'insights-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsFoundryApiDocument(snapshot = buildInsightsFoundrySnapshot()) {
  return {
    id: 'insights-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-foundry/overview' },
      { method: 'GET', path: '/api/insights-foundry/reporting' },
      { method: 'POST', path: '/api/insights-foundry/validate' },
      { method: 'GET', path: '/api/insights-foundry/audit' }
    ],
    readiness: createInsightsFoundryReadinessBoard(snapshot)
  };
}

export function createInsightsFoundryRouteSummary(snapshot = buildInsightsFoundrySnapshot()) {
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

