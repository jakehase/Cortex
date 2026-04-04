import { createDeliverabilityFoundryWorkspace, summarizeDeliverabilityFoundryWorkspace, createDeliverabilityFoundryNarratives, createDeliverabilityFoundryCoverageGrid } from './domain-deliverability-foundry.mjs';
import { createDeliverabilityFoundryPolicies, validateDeliverabilityFoundryPolicies, summarizeDeliverabilityFoundryPolicies, createDeliverabilityFoundryEscalationDeck } from './policies-deliverability-foundry.mjs';
import { createDeliverabilityFoundryAnalyticsTimeline, createDeliverabilityFoundryForecastEnvelope, createDeliverabilityFoundryExceptionLedger, summarizeDeliverabilityFoundryAnalytics } from './analytics-deliverability-foundry.mjs';
import { createDeliverabilityFoundryOperationsBoard, createDeliverabilityFoundryShiftChecklist, createDeliverabilityFoundryIncidentDeck } from './operations-deliverability-foundry.mjs';
import { createDeliverabilityFoundryReportCards, createDeliverabilityFoundryReviewPackets, summarizeDeliverabilityFoundryReporting } from './reporting-deliverability-foundry.mjs';
import { createDeliverabilityFoundryAuditTrail, createDeliverabilityFoundryEvidenceManifest, createDeliverabilityFoundryReadinessAttestation } from './audit-deliverability-foundry.mjs';
import { createDeliverabilityFoundryPlaybooks, createDeliverabilityFoundryDecisionDeck, createDeliverabilityFoundryEscalationMoments } from './playbooks-deliverability-foundry.mjs';

export function buildDeliverabilityFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityFoundryWorkspace(workspaceName);
  const policies = createDeliverabilityFoundryPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityFoundryWorkspace(workspace),
    narratives: createDeliverabilityFoundryNarratives(workspace),
    coverage: createDeliverabilityFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityFoundryPolicies(policies),
    validation: validateDeliverabilityFoundryPolicies(policies),
    escalationDeck: createDeliverabilityFoundryEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityFoundryAnalyticsTimeline(),
      forecast: createDeliverabilityFoundryForecastEnvelope(),
      exceptions: createDeliverabilityFoundryExceptionLedger(),
      summary: summarizeDeliverabilityFoundryAnalytics()
    },
    operations: {
      board: createDeliverabilityFoundryOperationsBoard(),
      checklist: createDeliverabilityFoundryShiftChecklist(),
      incidents: createDeliverabilityFoundryIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityFoundryReportCards(),
      packets: createDeliverabilityFoundryReviewPackets(),
      summary: summarizeDeliverabilityFoundryReporting()
    },
    audit: {
      trail: createDeliverabilityFoundryAuditTrail(),
      manifest: createDeliverabilityFoundryEvidenceManifest(),
      attestation: createDeliverabilityFoundryReadinessAttestation()
    },
    playbooks: createDeliverabilityFoundryPlaybooks(),
    decisions: createDeliverabilityFoundryDecisionDeck(),
    escalationMoments: createDeliverabilityFoundryEscalationMoments()
  };
}

export function createDeliverabilityFoundryReadinessBoard(snapshot = buildDeliverabilityFoundrySnapshot()) {
  return [
    { id: 'deliverability-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityFoundryApiDocument(snapshot = buildDeliverabilityFoundrySnapshot()) {
  return {
    id: 'deliverability-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-foundry/overview' },
      { method: 'GET', path: '/api/deliverability-foundry/reporting' },
      { method: 'POST', path: '/api/deliverability-foundry/validate' },
      { method: 'GET', path: '/api/deliverability-foundry/audit' }
    ],
    readiness: createDeliverabilityFoundryReadinessBoard(snapshot)
  };
}

export function createDeliverabilityFoundryRouteSummary(snapshot = buildDeliverabilityFoundrySnapshot()) {
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

