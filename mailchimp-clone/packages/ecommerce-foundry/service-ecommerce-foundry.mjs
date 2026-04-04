import { createEcommerceFoundryWorkspace, summarizeEcommerceFoundryWorkspace, createEcommerceFoundryNarratives, createEcommerceFoundryCoverageGrid } from './domain-ecommerce-foundry.mjs';
import { createEcommerceFoundryPolicies, validateEcommerceFoundryPolicies, summarizeEcommerceFoundryPolicies, createEcommerceFoundryEscalationDeck } from './policies-ecommerce-foundry.mjs';
import { createEcommerceFoundryAnalyticsTimeline, createEcommerceFoundryForecastEnvelope, createEcommerceFoundryExceptionLedger, summarizeEcommerceFoundryAnalytics } from './analytics-ecommerce-foundry.mjs';
import { createEcommerceFoundryOperationsBoard, createEcommerceFoundryShiftChecklist, createEcommerceFoundryIncidentDeck } from './operations-ecommerce-foundry.mjs';
import { createEcommerceFoundryReportCards, createEcommerceFoundryReviewPackets, summarizeEcommerceFoundryReporting } from './reporting-ecommerce-foundry.mjs';
import { createEcommerceFoundryAuditTrail, createEcommerceFoundryEvidenceManifest, createEcommerceFoundryReadinessAttestation } from './audit-ecommerce-foundry.mjs';
import { createEcommerceFoundryPlaybooks, createEcommerceFoundryDecisionDeck, createEcommerceFoundryEscalationMoments } from './playbooks-ecommerce-foundry.mjs';

export function buildEcommerceFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceFoundryWorkspace(workspaceName);
  const policies = createEcommerceFoundryPolicies();
  return {
    workspace,
    summary: summarizeEcommerceFoundryWorkspace(workspace),
    narratives: createEcommerceFoundryNarratives(workspace),
    coverage: createEcommerceFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceFoundryPolicies(policies),
    validation: validateEcommerceFoundryPolicies(policies),
    escalationDeck: createEcommerceFoundryEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceFoundryAnalyticsTimeline(),
      forecast: createEcommerceFoundryForecastEnvelope(),
      exceptions: createEcommerceFoundryExceptionLedger(),
      summary: summarizeEcommerceFoundryAnalytics()
    },
    operations: {
      board: createEcommerceFoundryOperationsBoard(),
      checklist: createEcommerceFoundryShiftChecklist(),
      incidents: createEcommerceFoundryIncidentDeck()
    },
    reporting: {
      cards: createEcommerceFoundryReportCards(),
      packets: createEcommerceFoundryReviewPackets(),
      summary: summarizeEcommerceFoundryReporting()
    },
    audit: {
      trail: createEcommerceFoundryAuditTrail(),
      manifest: createEcommerceFoundryEvidenceManifest(),
      attestation: createEcommerceFoundryReadinessAttestation()
    },
    playbooks: createEcommerceFoundryPlaybooks(),
    decisions: createEcommerceFoundryDecisionDeck(),
    escalationMoments: createEcommerceFoundryEscalationMoments()
  };
}

export function createEcommerceFoundryReadinessBoard(snapshot = buildEcommerceFoundrySnapshot()) {
  return [
    { id: 'ecommerce-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceFoundryApiDocument(snapshot = buildEcommerceFoundrySnapshot()) {
  return {
    id: 'ecommerce-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-foundry/overview' },
      { method: 'GET', path: '/api/ecommerce-foundry/reporting' },
      { method: 'POST', path: '/api/ecommerce-foundry/validate' },
      { method: 'GET', path: '/api/ecommerce-foundry/audit' }
    ],
    readiness: createEcommerceFoundryReadinessBoard(snapshot)
  };
}

export function createEcommerceFoundryRouteSummary(snapshot = buildEcommerceFoundrySnapshot()) {
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

