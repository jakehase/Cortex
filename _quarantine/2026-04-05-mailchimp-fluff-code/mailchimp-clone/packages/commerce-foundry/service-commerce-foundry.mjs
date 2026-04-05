import { createCommerceFoundryWorkspace, summarizeCommerceFoundryWorkspace, createCommerceFoundryNarratives, createCommerceFoundryCoverageGrid } from './domain-commerce-foundry.mjs';
import { createCommerceFoundryPolicies, validateCommerceFoundryPolicies, summarizeCommerceFoundryPolicies, createCommerceFoundryEscalationDeck } from './policies-commerce-foundry.mjs';
import { createCommerceFoundryAnalyticsTimeline, createCommerceFoundryForecastEnvelope, createCommerceFoundryExceptionLedger, summarizeCommerceFoundryAnalytics } from './analytics-commerce-foundry.mjs';
import { createCommerceFoundryOperationsBoard, createCommerceFoundryShiftChecklist, createCommerceFoundryIncidentDeck } from './operations-commerce-foundry.mjs';
import { createCommerceFoundryReportCards, createCommerceFoundryReviewPackets, summarizeCommerceFoundryReporting } from './reporting-commerce-foundry.mjs';
import { createCommerceFoundryAuditTrail, createCommerceFoundryEvidenceManifest, createCommerceFoundryReadinessAttestation } from './audit-commerce-foundry.mjs';
import { createCommerceFoundryPlaybooks, createCommerceFoundryDecisionDeck, createCommerceFoundryEscalationMoments } from './playbooks-commerce-foundry.mjs';

export function buildCommerceFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceFoundryWorkspace(workspaceName);
  const policies = createCommerceFoundryPolicies();
  return {
    workspace,
    summary: summarizeCommerceFoundryWorkspace(workspace),
    narratives: createCommerceFoundryNarratives(workspace),
    coverage: createCommerceFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceFoundryPolicies(policies),
    validation: validateCommerceFoundryPolicies(policies),
    escalationDeck: createCommerceFoundryEscalationDeck(policies),
    analytics: {
      timeline: createCommerceFoundryAnalyticsTimeline(),
      forecast: createCommerceFoundryForecastEnvelope(),
      exceptions: createCommerceFoundryExceptionLedger(),
      summary: summarizeCommerceFoundryAnalytics()
    },
    operations: {
      board: createCommerceFoundryOperationsBoard(),
      checklist: createCommerceFoundryShiftChecklist(),
      incidents: createCommerceFoundryIncidentDeck()
    },
    reporting: {
      cards: createCommerceFoundryReportCards(),
      packets: createCommerceFoundryReviewPackets(),
      summary: summarizeCommerceFoundryReporting()
    },
    audit: {
      trail: createCommerceFoundryAuditTrail(),
      manifest: createCommerceFoundryEvidenceManifest(),
      attestation: createCommerceFoundryReadinessAttestation()
    },
    playbooks: createCommerceFoundryPlaybooks(),
    decisions: createCommerceFoundryDecisionDeck(),
    escalationMoments: createCommerceFoundryEscalationMoments()
  };
}

export function createCommerceFoundryReadinessBoard(snapshot = buildCommerceFoundrySnapshot()) {
  return [
    { id: 'commerce-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceFoundryApiDocument(snapshot = buildCommerceFoundrySnapshot()) {
  return {
    id: 'commerce-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-foundry/overview' },
      { method: 'GET', path: '/api/commerce-foundry/reporting' },
      { method: 'POST', path: '/api/commerce-foundry/validate' },
      { method: 'GET', path: '/api/commerce-foundry/audit' }
    ],
    readiness: createCommerceFoundryReadinessBoard(snapshot)
  };
}

export function createCommerceFoundryRouteSummary(snapshot = buildCommerceFoundrySnapshot()) {
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

