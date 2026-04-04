import { createAutomationFoundryWorkspace, summarizeAutomationFoundryWorkspace, createAutomationFoundryNarratives, createAutomationFoundryCoverageGrid } from './domain-automation-foundry.mjs';
import { createAutomationFoundryPolicies, validateAutomationFoundryPolicies, summarizeAutomationFoundryPolicies, createAutomationFoundryEscalationDeck } from './policies-automation-foundry.mjs';
import { createAutomationFoundryAnalyticsTimeline, createAutomationFoundryForecastEnvelope, createAutomationFoundryExceptionLedger, summarizeAutomationFoundryAnalytics } from './analytics-automation-foundry.mjs';
import { createAutomationFoundryOperationsBoard, createAutomationFoundryShiftChecklist, createAutomationFoundryIncidentDeck } from './operations-automation-foundry.mjs';
import { createAutomationFoundryReportCards, createAutomationFoundryReviewPackets, summarizeAutomationFoundryReporting } from './reporting-automation-foundry.mjs';
import { createAutomationFoundryAuditTrail, createAutomationFoundryEvidenceManifest, createAutomationFoundryReadinessAttestation } from './audit-automation-foundry.mjs';
import { createAutomationFoundryPlaybooks, createAutomationFoundryDecisionDeck, createAutomationFoundryEscalationMoments } from './playbooks-automation-foundry.mjs';

export function buildAutomationFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationFoundryWorkspace(workspaceName);
  const policies = createAutomationFoundryPolicies();
  return {
    workspace,
    summary: summarizeAutomationFoundryWorkspace(workspace),
    narratives: createAutomationFoundryNarratives(workspace),
    coverage: createAutomationFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationFoundryPolicies(policies),
    validation: validateAutomationFoundryPolicies(policies),
    escalationDeck: createAutomationFoundryEscalationDeck(policies),
    analytics: {
      timeline: createAutomationFoundryAnalyticsTimeline(),
      forecast: createAutomationFoundryForecastEnvelope(),
      exceptions: createAutomationFoundryExceptionLedger(),
      summary: summarizeAutomationFoundryAnalytics()
    },
    operations: {
      board: createAutomationFoundryOperationsBoard(),
      checklist: createAutomationFoundryShiftChecklist(),
      incidents: createAutomationFoundryIncidentDeck()
    },
    reporting: {
      cards: createAutomationFoundryReportCards(),
      packets: createAutomationFoundryReviewPackets(),
      summary: summarizeAutomationFoundryReporting()
    },
    audit: {
      trail: createAutomationFoundryAuditTrail(),
      manifest: createAutomationFoundryEvidenceManifest(),
      attestation: createAutomationFoundryReadinessAttestation()
    },
    playbooks: createAutomationFoundryPlaybooks(),
    decisions: createAutomationFoundryDecisionDeck(),
    escalationMoments: createAutomationFoundryEscalationMoments()
  };
}

export function createAutomationFoundryReadinessBoard(snapshot = buildAutomationFoundrySnapshot()) {
  return [
    { id: 'automation-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationFoundryApiDocument(snapshot = buildAutomationFoundrySnapshot()) {
  return {
    id: 'automation-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-foundry/overview' },
      { method: 'GET', path: '/api/automation-foundry/reporting' },
      { method: 'POST', path: '/api/automation-foundry/validate' },
      { method: 'GET', path: '/api/automation-foundry/audit' }
    ],
    readiness: createAutomationFoundryReadinessBoard(snapshot)
  };
}

export function createAutomationFoundryRouteSummary(snapshot = buildAutomationFoundrySnapshot()) {
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

