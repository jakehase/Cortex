import { createAnalyticsFoundryWorkspace, summarizeAnalyticsFoundryWorkspace, createAnalyticsFoundryNarratives, createAnalyticsFoundryCoverageGrid } from './domain-analytics-foundry.mjs';
import { createAnalyticsFoundryPolicies, validateAnalyticsFoundryPolicies, summarizeAnalyticsFoundryPolicies, createAnalyticsFoundryEscalationDeck } from './policies-analytics-foundry.mjs';
import { createAnalyticsFoundryAnalyticsTimeline, createAnalyticsFoundryForecastEnvelope, createAnalyticsFoundryExceptionLedger, summarizeAnalyticsFoundryAnalytics } from './analytics-analytics-foundry.mjs';
import { createAnalyticsFoundryOperationsBoard, createAnalyticsFoundryShiftChecklist, createAnalyticsFoundryIncidentDeck } from './operations-analytics-foundry.mjs';
import { createAnalyticsFoundryReportCards, createAnalyticsFoundryReviewPackets, summarizeAnalyticsFoundryReporting } from './reporting-analytics-foundry.mjs';
import { createAnalyticsFoundryAuditTrail, createAnalyticsFoundryEvidenceManifest, createAnalyticsFoundryReadinessAttestation } from './audit-analytics-foundry.mjs';
import { createAnalyticsFoundryPlaybooks, createAnalyticsFoundryDecisionDeck, createAnalyticsFoundryEscalationMoments } from './playbooks-analytics-foundry.mjs';

export function buildAnalyticsFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsFoundryWorkspace(workspaceName);
  const policies = createAnalyticsFoundryPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsFoundryWorkspace(workspace),
    narratives: createAnalyticsFoundryNarratives(workspace),
    coverage: createAnalyticsFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsFoundryPolicies(policies),
    validation: validateAnalyticsFoundryPolicies(policies),
    escalationDeck: createAnalyticsFoundryEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsFoundryAnalyticsTimeline(),
      forecast: createAnalyticsFoundryForecastEnvelope(),
      exceptions: createAnalyticsFoundryExceptionLedger(),
      summary: summarizeAnalyticsFoundryAnalytics()
    },
    operations: {
      board: createAnalyticsFoundryOperationsBoard(),
      checklist: createAnalyticsFoundryShiftChecklist(),
      incidents: createAnalyticsFoundryIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsFoundryReportCards(),
      packets: createAnalyticsFoundryReviewPackets(),
      summary: summarizeAnalyticsFoundryReporting()
    },
    audit: {
      trail: createAnalyticsFoundryAuditTrail(),
      manifest: createAnalyticsFoundryEvidenceManifest(),
      attestation: createAnalyticsFoundryReadinessAttestation()
    },
    playbooks: createAnalyticsFoundryPlaybooks(),
    decisions: createAnalyticsFoundryDecisionDeck(),
    escalationMoments: createAnalyticsFoundryEscalationMoments()
  };
}

export function createAnalyticsFoundryReadinessBoard(snapshot = buildAnalyticsFoundrySnapshot()) {
  return [
    { id: 'analytics-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsFoundryApiDocument(snapshot = buildAnalyticsFoundrySnapshot()) {
  return {
    id: 'analytics-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-foundry/overview' },
      { method: 'GET', path: '/api/analytics-foundry/reporting' },
      { method: 'POST', path: '/api/analytics-foundry/validate' },
      { method: 'GET', path: '/api/analytics-foundry/audit' }
    ],
    readiness: createAnalyticsFoundryReadinessBoard(snapshot)
  };
}

export function createAnalyticsFoundryRouteSummary(snapshot = buildAnalyticsFoundrySnapshot()) {
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

