import { createCustomerFoundryWorkspace, summarizeCustomerFoundryWorkspace, createCustomerFoundryNarratives, createCustomerFoundryCoverageGrid } from './domain-customer-foundry.mjs';
import { createCustomerFoundryPolicies, validateCustomerFoundryPolicies, summarizeCustomerFoundryPolicies, createCustomerFoundryEscalationDeck } from './policies-customer-foundry.mjs';
import { createCustomerFoundryAnalyticsTimeline, createCustomerFoundryForecastEnvelope, createCustomerFoundryExceptionLedger, summarizeCustomerFoundryAnalytics } from './analytics-customer-foundry.mjs';
import { createCustomerFoundryOperationsBoard, createCustomerFoundryShiftChecklist, createCustomerFoundryIncidentDeck } from './operations-customer-foundry.mjs';
import { createCustomerFoundryReportCards, createCustomerFoundryReviewPackets, summarizeCustomerFoundryReporting } from './reporting-customer-foundry.mjs';
import { createCustomerFoundryAuditTrail, createCustomerFoundryEvidenceManifest, createCustomerFoundryReadinessAttestation } from './audit-customer-foundry.mjs';
import { createCustomerFoundryPlaybooks, createCustomerFoundryDecisionDeck, createCustomerFoundryEscalationMoments } from './playbooks-customer-foundry.mjs';

export function buildCustomerFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerFoundryWorkspace(workspaceName);
  const policies = createCustomerFoundryPolicies();
  return {
    workspace,
    summary: summarizeCustomerFoundryWorkspace(workspace),
    narratives: createCustomerFoundryNarratives(workspace),
    coverage: createCustomerFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerFoundryPolicies(policies),
    validation: validateCustomerFoundryPolicies(policies),
    escalationDeck: createCustomerFoundryEscalationDeck(policies),
    analytics: {
      timeline: createCustomerFoundryAnalyticsTimeline(),
      forecast: createCustomerFoundryForecastEnvelope(),
      exceptions: createCustomerFoundryExceptionLedger(),
      summary: summarizeCustomerFoundryAnalytics()
    },
    operations: {
      board: createCustomerFoundryOperationsBoard(),
      checklist: createCustomerFoundryShiftChecklist(),
      incidents: createCustomerFoundryIncidentDeck()
    },
    reporting: {
      cards: createCustomerFoundryReportCards(),
      packets: createCustomerFoundryReviewPackets(),
      summary: summarizeCustomerFoundryReporting()
    },
    audit: {
      trail: createCustomerFoundryAuditTrail(),
      manifest: createCustomerFoundryEvidenceManifest(),
      attestation: createCustomerFoundryReadinessAttestation()
    },
    playbooks: createCustomerFoundryPlaybooks(),
    decisions: createCustomerFoundryDecisionDeck(),
    escalationMoments: createCustomerFoundryEscalationMoments()
  };
}

export function createCustomerFoundryReadinessBoard(snapshot = buildCustomerFoundrySnapshot()) {
  return [
    { id: 'customer-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerFoundryApiDocument(snapshot = buildCustomerFoundrySnapshot()) {
  return {
    id: 'customer-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-foundry/overview' },
      { method: 'GET', path: '/api/customer-foundry/reporting' },
      { method: 'POST', path: '/api/customer-foundry/validate' },
      { method: 'GET', path: '/api/customer-foundry/audit' }
    ],
    readiness: createCustomerFoundryReadinessBoard(snapshot)
  };
}

export function createCustomerFoundryRouteSummary(snapshot = buildCustomerFoundrySnapshot()) {
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

