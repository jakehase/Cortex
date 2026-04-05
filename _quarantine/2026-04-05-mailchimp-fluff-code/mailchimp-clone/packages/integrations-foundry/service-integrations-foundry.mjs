import { createIntegrationsFoundryWorkspace, summarizeIntegrationsFoundryWorkspace, createIntegrationsFoundryNarratives, createIntegrationsFoundryCoverageGrid } from './domain-integrations-foundry.mjs';
import { createIntegrationsFoundryPolicies, validateIntegrationsFoundryPolicies, summarizeIntegrationsFoundryPolicies, createIntegrationsFoundryEscalationDeck } from './policies-integrations-foundry.mjs';
import { createIntegrationsFoundryAnalyticsTimeline, createIntegrationsFoundryForecastEnvelope, createIntegrationsFoundryExceptionLedger, summarizeIntegrationsFoundryAnalytics } from './analytics-integrations-foundry.mjs';
import { createIntegrationsFoundryOperationsBoard, createIntegrationsFoundryShiftChecklist, createIntegrationsFoundryIncidentDeck } from './operations-integrations-foundry.mjs';
import { createIntegrationsFoundryReportCards, createIntegrationsFoundryReviewPackets, summarizeIntegrationsFoundryReporting } from './reporting-integrations-foundry.mjs';
import { createIntegrationsFoundryAuditTrail, createIntegrationsFoundryEvidenceManifest, createIntegrationsFoundryReadinessAttestation } from './audit-integrations-foundry.mjs';
import { createIntegrationsFoundryPlaybooks, createIntegrationsFoundryDecisionDeck, createIntegrationsFoundryEscalationMoments } from './playbooks-integrations-foundry.mjs';

export function buildIntegrationsFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsFoundryWorkspace(workspaceName);
  const policies = createIntegrationsFoundryPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsFoundryWorkspace(workspace),
    narratives: createIntegrationsFoundryNarratives(workspace),
    coverage: createIntegrationsFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsFoundryPolicies(policies),
    validation: validateIntegrationsFoundryPolicies(policies),
    escalationDeck: createIntegrationsFoundryEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsFoundryAnalyticsTimeline(),
      forecast: createIntegrationsFoundryForecastEnvelope(),
      exceptions: createIntegrationsFoundryExceptionLedger(),
      summary: summarizeIntegrationsFoundryAnalytics()
    },
    operations: {
      board: createIntegrationsFoundryOperationsBoard(),
      checklist: createIntegrationsFoundryShiftChecklist(),
      incidents: createIntegrationsFoundryIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsFoundryReportCards(),
      packets: createIntegrationsFoundryReviewPackets(),
      summary: summarizeIntegrationsFoundryReporting()
    },
    audit: {
      trail: createIntegrationsFoundryAuditTrail(),
      manifest: createIntegrationsFoundryEvidenceManifest(),
      attestation: createIntegrationsFoundryReadinessAttestation()
    },
    playbooks: createIntegrationsFoundryPlaybooks(),
    decisions: createIntegrationsFoundryDecisionDeck(),
    escalationMoments: createIntegrationsFoundryEscalationMoments()
  };
}

export function createIntegrationsFoundryReadinessBoard(snapshot = buildIntegrationsFoundrySnapshot()) {
  return [
    { id: 'integrations-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsFoundryApiDocument(snapshot = buildIntegrationsFoundrySnapshot()) {
  return {
    id: 'integrations-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-foundry/overview' },
      { method: 'GET', path: '/api/integrations-foundry/reporting' },
      { method: 'POST', path: '/api/integrations-foundry/validate' },
      { method: 'GET', path: '/api/integrations-foundry/audit' }
    ],
    readiness: createIntegrationsFoundryReadinessBoard(snapshot)
  };
}

export function createIntegrationsFoundryRouteSummary(snapshot = buildIntegrationsFoundrySnapshot()) {
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

