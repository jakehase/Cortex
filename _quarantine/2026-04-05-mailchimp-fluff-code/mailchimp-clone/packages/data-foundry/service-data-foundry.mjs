import { createDataFoundryWorkspace, summarizeDataFoundryWorkspace, createDataFoundryNarratives, createDataFoundryCoverageGrid } from './domain-data-foundry.mjs';
import { createDataFoundryPolicies, validateDataFoundryPolicies, summarizeDataFoundryPolicies, createDataFoundryEscalationDeck } from './policies-data-foundry.mjs';
import { createDataFoundryAnalyticsTimeline, createDataFoundryForecastEnvelope, createDataFoundryExceptionLedger, summarizeDataFoundryAnalytics } from './analytics-data-foundry.mjs';
import { createDataFoundryOperationsBoard, createDataFoundryShiftChecklist, createDataFoundryIncidentDeck } from './operations-data-foundry.mjs';
import { createDataFoundryReportCards, createDataFoundryReviewPackets, summarizeDataFoundryReporting } from './reporting-data-foundry.mjs';
import { createDataFoundryAuditTrail, createDataFoundryEvidenceManifest, createDataFoundryReadinessAttestation } from './audit-data-foundry.mjs';
import { createDataFoundryPlaybooks, createDataFoundryDecisionDeck, createDataFoundryEscalationMoments } from './playbooks-data-foundry.mjs';

export function buildDataFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataFoundryWorkspace(workspaceName);
  const policies = createDataFoundryPolicies();
  return {
    workspace,
    summary: summarizeDataFoundryWorkspace(workspace),
    narratives: createDataFoundryNarratives(workspace),
    coverage: createDataFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataFoundryPolicies(policies),
    validation: validateDataFoundryPolicies(policies),
    escalationDeck: createDataFoundryEscalationDeck(policies),
    analytics: {
      timeline: createDataFoundryAnalyticsTimeline(),
      forecast: createDataFoundryForecastEnvelope(),
      exceptions: createDataFoundryExceptionLedger(),
      summary: summarizeDataFoundryAnalytics()
    },
    operations: {
      board: createDataFoundryOperationsBoard(),
      checklist: createDataFoundryShiftChecklist(),
      incidents: createDataFoundryIncidentDeck()
    },
    reporting: {
      cards: createDataFoundryReportCards(),
      packets: createDataFoundryReviewPackets(),
      summary: summarizeDataFoundryReporting()
    },
    audit: {
      trail: createDataFoundryAuditTrail(),
      manifest: createDataFoundryEvidenceManifest(),
      attestation: createDataFoundryReadinessAttestation()
    },
    playbooks: createDataFoundryPlaybooks(),
    decisions: createDataFoundryDecisionDeck(),
    escalationMoments: createDataFoundryEscalationMoments()
  };
}

export function createDataFoundryReadinessBoard(snapshot = buildDataFoundrySnapshot()) {
  return [
    { id: 'data-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataFoundryApiDocument(snapshot = buildDataFoundrySnapshot()) {
  return {
    id: 'data-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-foundry/overview' },
      { method: 'GET', path: '/api/data-foundry/reporting' },
      { method: 'POST', path: '/api/data-foundry/validate' },
      { method: 'GET', path: '/api/data-foundry/audit' }
    ],
    readiness: createDataFoundryReadinessBoard(snapshot)
  };
}

export function createDataFoundryRouteSummary(snapshot = buildDataFoundrySnapshot()) {
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

