import { createBillingFoundryWorkspace, summarizeBillingFoundryWorkspace, createBillingFoundryNarratives, createBillingFoundryCoverageGrid } from './domain-billing-foundry.mjs';
import { createBillingFoundryPolicies, validateBillingFoundryPolicies, summarizeBillingFoundryPolicies, createBillingFoundryEscalationDeck } from './policies-billing-foundry.mjs';
import { createBillingFoundryAnalyticsTimeline, createBillingFoundryForecastEnvelope, createBillingFoundryExceptionLedger, summarizeBillingFoundryAnalytics } from './analytics-billing-foundry.mjs';
import { createBillingFoundryOperationsBoard, createBillingFoundryShiftChecklist, createBillingFoundryIncidentDeck } from './operations-billing-foundry.mjs';
import { createBillingFoundryReportCards, createBillingFoundryReviewPackets, summarizeBillingFoundryReporting } from './reporting-billing-foundry.mjs';
import { createBillingFoundryAuditTrail, createBillingFoundryEvidenceManifest, createBillingFoundryReadinessAttestation } from './audit-billing-foundry.mjs';
import { createBillingFoundryPlaybooks, createBillingFoundryDecisionDeck, createBillingFoundryEscalationMoments } from './playbooks-billing-foundry.mjs';

export function buildBillingFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingFoundryWorkspace(workspaceName);
  const policies = createBillingFoundryPolicies();
  return {
    workspace,
    summary: summarizeBillingFoundryWorkspace(workspace),
    narratives: createBillingFoundryNarratives(workspace),
    coverage: createBillingFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingFoundryPolicies(policies),
    validation: validateBillingFoundryPolicies(policies),
    escalationDeck: createBillingFoundryEscalationDeck(policies),
    analytics: {
      timeline: createBillingFoundryAnalyticsTimeline(),
      forecast: createBillingFoundryForecastEnvelope(),
      exceptions: createBillingFoundryExceptionLedger(),
      summary: summarizeBillingFoundryAnalytics()
    },
    operations: {
      board: createBillingFoundryOperationsBoard(),
      checklist: createBillingFoundryShiftChecklist(),
      incidents: createBillingFoundryIncidentDeck()
    },
    reporting: {
      cards: createBillingFoundryReportCards(),
      packets: createBillingFoundryReviewPackets(),
      summary: summarizeBillingFoundryReporting()
    },
    audit: {
      trail: createBillingFoundryAuditTrail(),
      manifest: createBillingFoundryEvidenceManifest(),
      attestation: createBillingFoundryReadinessAttestation()
    },
    playbooks: createBillingFoundryPlaybooks(),
    decisions: createBillingFoundryDecisionDeck(),
    escalationMoments: createBillingFoundryEscalationMoments()
  };
}

export function createBillingFoundryReadinessBoard(snapshot = buildBillingFoundrySnapshot()) {
  return [
    { id: 'billing-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingFoundryApiDocument(snapshot = buildBillingFoundrySnapshot()) {
  return {
    id: 'billing-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-foundry/overview' },
      { method: 'GET', path: '/api/billing-foundry/reporting' },
      { method: 'POST', path: '/api/billing-foundry/validate' },
      { method: 'GET', path: '/api/billing-foundry/audit' }
    ],
    readiness: createBillingFoundryReadinessBoard(snapshot)
  };
}

export function createBillingFoundryRouteSummary(snapshot = buildBillingFoundrySnapshot()) {
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

