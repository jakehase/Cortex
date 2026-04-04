import { createAttributionFoundryWorkspace, summarizeAttributionFoundryWorkspace, createAttributionFoundryNarratives, createAttributionFoundryCoverageGrid } from './domain-attribution-foundry.mjs';
import { createAttributionFoundryPolicies, validateAttributionFoundryPolicies, summarizeAttributionFoundryPolicies, createAttributionFoundryEscalationDeck } from './policies-attribution-foundry.mjs';
import { createAttributionFoundryAnalyticsTimeline, createAttributionFoundryForecastEnvelope, createAttributionFoundryExceptionLedger, summarizeAttributionFoundryAnalytics } from './analytics-attribution-foundry.mjs';
import { createAttributionFoundryOperationsBoard, createAttributionFoundryShiftChecklist, createAttributionFoundryIncidentDeck } from './operations-attribution-foundry.mjs';
import { createAttributionFoundryReportCards, createAttributionFoundryReviewPackets, summarizeAttributionFoundryReporting } from './reporting-attribution-foundry.mjs';
import { createAttributionFoundryAuditTrail, createAttributionFoundryEvidenceManifest, createAttributionFoundryReadinessAttestation } from './audit-attribution-foundry.mjs';
import { createAttributionFoundryPlaybooks, createAttributionFoundryDecisionDeck, createAttributionFoundryEscalationMoments } from './playbooks-attribution-foundry.mjs';

export function buildAttributionFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionFoundryWorkspace(workspaceName);
  const policies = createAttributionFoundryPolicies();
  return {
    workspace,
    summary: summarizeAttributionFoundryWorkspace(workspace),
    narratives: createAttributionFoundryNarratives(workspace),
    coverage: createAttributionFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionFoundryPolicies(policies),
    validation: validateAttributionFoundryPolicies(policies),
    escalationDeck: createAttributionFoundryEscalationDeck(policies),
    analytics: {
      timeline: createAttributionFoundryAnalyticsTimeline(),
      forecast: createAttributionFoundryForecastEnvelope(),
      exceptions: createAttributionFoundryExceptionLedger(),
      summary: summarizeAttributionFoundryAnalytics()
    },
    operations: {
      board: createAttributionFoundryOperationsBoard(),
      checklist: createAttributionFoundryShiftChecklist(),
      incidents: createAttributionFoundryIncidentDeck()
    },
    reporting: {
      cards: createAttributionFoundryReportCards(),
      packets: createAttributionFoundryReviewPackets(),
      summary: summarizeAttributionFoundryReporting()
    },
    audit: {
      trail: createAttributionFoundryAuditTrail(),
      manifest: createAttributionFoundryEvidenceManifest(),
      attestation: createAttributionFoundryReadinessAttestation()
    },
    playbooks: createAttributionFoundryPlaybooks(),
    decisions: createAttributionFoundryDecisionDeck(),
    escalationMoments: createAttributionFoundryEscalationMoments()
  };
}

export function createAttributionFoundryReadinessBoard(snapshot = buildAttributionFoundrySnapshot()) {
  return [
    { id: 'attribution-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionFoundryApiDocument(snapshot = buildAttributionFoundrySnapshot()) {
  return {
    id: 'attribution-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-foundry/overview' },
      { method: 'GET', path: '/api/attribution-foundry/reporting' },
      { method: 'POST', path: '/api/attribution-foundry/validate' },
      { method: 'GET', path: '/api/attribution-foundry/audit' }
    ],
    readiness: createAttributionFoundryReadinessBoard(snapshot)
  };
}

export function createAttributionFoundryRouteSummary(snapshot = buildAttributionFoundrySnapshot()) {
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

