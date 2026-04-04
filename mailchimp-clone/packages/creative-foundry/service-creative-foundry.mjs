import { createCreativeFoundryWorkspace, summarizeCreativeFoundryWorkspace, createCreativeFoundryNarratives, createCreativeFoundryCoverageGrid } from './domain-creative-foundry.mjs';
import { createCreativeFoundryPolicies, validateCreativeFoundryPolicies, summarizeCreativeFoundryPolicies, createCreativeFoundryEscalationDeck } from './policies-creative-foundry.mjs';
import { createCreativeFoundryAnalyticsTimeline, createCreativeFoundryForecastEnvelope, createCreativeFoundryExceptionLedger, summarizeCreativeFoundryAnalytics } from './analytics-creative-foundry.mjs';
import { createCreativeFoundryOperationsBoard, createCreativeFoundryShiftChecklist, createCreativeFoundryIncidentDeck } from './operations-creative-foundry.mjs';
import { createCreativeFoundryReportCards, createCreativeFoundryReviewPackets, summarizeCreativeFoundryReporting } from './reporting-creative-foundry.mjs';
import { createCreativeFoundryAuditTrail, createCreativeFoundryEvidenceManifest, createCreativeFoundryReadinessAttestation } from './audit-creative-foundry.mjs';
import { createCreativeFoundryPlaybooks, createCreativeFoundryDecisionDeck, createCreativeFoundryEscalationMoments } from './playbooks-creative-foundry.mjs';

export function buildCreativeFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeFoundryWorkspace(workspaceName);
  const policies = createCreativeFoundryPolicies();
  return {
    workspace,
    summary: summarizeCreativeFoundryWorkspace(workspace),
    narratives: createCreativeFoundryNarratives(workspace),
    coverage: createCreativeFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeFoundryPolicies(policies),
    validation: validateCreativeFoundryPolicies(policies),
    escalationDeck: createCreativeFoundryEscalationDeck(policies),
    analytics: {
      timeline: createCreativeFoundryAnalyticsTimeline(),
      forecast: createCreativeFoundryForecastEnvelope(),
      exceptions: createCreativeFoundryExceptionLedger(),
      summary: summarizeCreativeFoundryAnalytics()
    },
    operations: {
      board: createCreativeFoundryOperationsBoard(),
      checklist: createCreativeFoundryShiftChecklist(),
      incidents: createCreativeFoundryIncidentDeck()
    },
    reporting: {
      cards: createCreativeFoundryReportCards(),
      packets: createCreativeFoundryReviewPackets(),
      summary: summarizeCreativeFoundryReporting()
    },
    audit: {
      trail: createCreativeFoundryAuditTrail(),
      manifest: createCreativeFoundryEvidenceManifest(),
      attestation: createCreativeFoundryReadinessAttestation()
    },
    playbooks: createCreativeFoundryPlaybooks(),
    decisions: createCreativeFoundryDecisionDeck(),
    escalationMoments: createCreativeFoundryEscalationMoments()
  };
}

export function createCreativeFoundryReadinessBoard(snapshot = buildCreativeFoundrySnapshot()) {
  return [
    { id: 'creative-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeFoundryApiDocument(snapshot = buildCreativeFoundrySnapshot()) {
  return {
    id: 'creative-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-foundry/overview' },
      { method: 'GET', path: '/api/creative-foundry/reporting' },
      { method: 'POST', path: '/api/creative-foundry/validate' },
      { method: 'GET', path: '/api/creative-foundry/audit' }
    ],
    readiness: createCreativeFoundryReadinessBoard(snapshot)
  };
}

export function createCreativeFoundryRouteSummary(snapshot = buildCreativeFoundrySnapshot()) {
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

