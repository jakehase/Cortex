import { createActivationFoundryWorkspace, summarizeActivationFoundryWorkspace, createActivationFoundryNarratives, createActivationFoundryCoverageGrid } from './domain-activation-foundry.mjs';
import { createActivationFoundryPolicies, validateActivationFoundryPolicies, summarizeActivationFoundryPolicies, createActivationFoundryEscalationDeck } from './policies-activation-foundry.mjs';
import { createActivationFoundryAnalyticsTimeline, createActivationFoundryForecastEnvelope, createActivationFoundryExceptionLedger, summarizeActivationFoundryAnalytics } from './analytics-activation-foundry.mjs';
import { createActivationFoundryOperationsBoard, createActivationFoundryShiftChecklist, createActivationFoundryIncidentDeck } from './operations-activation-foundry.mjs';
import { createActivationFoundryReportCards, createActivationFoundryReviewPackets, summarizeActivationFoundryReporting } from './reporting-activation-foundry.mjs';
import { createActivationFoundryAuditTrail, createActivationFoundryEvidenceManifest, createActivationFoundryReadinessAttestation } from './audit-activation-foundry.mjs';
import { createActivationFoundryPlaybooks, createActivationFoundryDecisionDeck, createActivationFoundryEscalationMoments } from './playbooks-activation-foundry.mjs';

export function buildActivationFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationFoundryWorkspace(workspaceName);
  const policies = createActivationFoundryPolicies();
  return {
    workspace,
    summary: summarizeActivationFoundryWorkspace(workspace),
    narratives: createActivationFoundryNarratives(workspace),
    coverage: createActivationFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationFoundryPolicies(policies),
    validation: validateActivationFoundryPolicies(policies),
    escalationDeck: createActivationFoundryEscalationDeck(policies),
    analytics: {
      timeline: createActivationFoundryAnalyticsTimeline(),
      forecast: createActivationFoundryForecastEnvelope(),
      exceptions: createActivationFoundryExceptionLedger(),
      summary: summarizeActivationFoundryAnalytics()
    },
    operations: {
      board: createActivationFoundryOperationsBoard(),
      checklist: createActivationFoundryShiftChecklist(),
      incidents: createActivationFoundryIncidentDeck()
    },
    reporting: {
      cards: createActivationFoundryReportCards(),
      packets: createActivationFoundryReviewPackets(),
      summary: summarizeActivationFoundryReporting()
    },
    audit: {
      trail: createActivationFoundryAuditTrail(),
      manifest: createActivationFoundryEvidenceManifest(),
      attestation: createActivationFoundryReadinessAttestation()
    },
    playbooks: createActivationFoundryPlaybooks(),
    decisions: createActivationFoundryDecisionDeck(),
    escalationMoments: createActivationFoundryEscalationMoments()
  };
}

export function createActivationFoundryReadinessBoard(snapshot = buildActivationFoundrySnapshot()) {
  return [
    { id: 'activation-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationFoundryApiDocument(snapshot = buildActivationFoundrySnapshot()) {
  return {
    id: 'activation-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-foundry/overview' },
      { method: 'GET', path: '/api/activation-foundry/reporting' },
      { method: 'POST', path: '/api/activation-foundry/validate' },
      { method: 'GET', path: '/api/activation-foundry/audit' }
    ],
    readiness: createActivationFoundryReadinessBoard(snapshot)
  };
}

export function createActivationFoundryRouteSummary(snapshot = buildActivationFoundrySnapshot()) {
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

