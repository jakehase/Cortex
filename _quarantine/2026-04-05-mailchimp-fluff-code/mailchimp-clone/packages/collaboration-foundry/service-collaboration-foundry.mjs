import { createCollaborationFoundryWorkspace, summarizeCollaborationFoundryWorkspace, createCollaborationFoundryNarratives, createCollaborationFoundryCoverageGrid } from './domain-collaboration-foundry.mjs';
import { createCollaborationFoundryPolicies, validateCollaborationFoundryPolicies, summarizeCollaborationFoundryPolicies, createCollaborationFoundryEscalationDeck } from './policies-collaboration-foundry.mjs';
import { createCollaborationFoundryAnalyticsTimeline, createCollaborationFoundryForecastEnvelope, createCollaborationFoundryExceptionLedger, summarizeCollaborationFoundryAnalytics } from './analytics-collaboration-foundry.mjs';
import { createCollaborationFoundryOperationsBoard, createCollaborationFoundryShiftChecklist, createCollaborationFoundryIncidentDeck } from './operations-collaboration-foundry.mjs';
import { createCollaborationFoundryReportCards, createCollaborationFoundryReviewPackets, summarizeCollaborationFoundryReporting } from './reporting-collaboration-foundry.mjs';
import { createCollaborationFoundryAuditTrail, createCollaborationFoundryEvidenceManifest, createCollaborationFoundryReadinessAttestation } from './audit-collaboration-foundry.mjs';
import { createCollaborationFoundryPlaybooks, createCollaborationFoundryDecisionDeck, createCollaborationFoundryEscalationMoments } from './playbooks-collaboration-foundry.mjs';

export function buildCollaborationFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationFoundryWorkspace(workspaceName);
  const policies = createCollaborationFoundryPolicies();
  return {
    workspace,
    summary: summarizeCollaborationFoundryWorkspace(workspace),
    narratives: createCollaborationFoundryNarratives(workspace),
    coverage: createCollaborationFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationFoundryPolicies(policies),
    validation: validateCollaborationFoundryPolicies(policies),
    escalationDeck: createCollaborationFoundryEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationFoundryAnalyticsTimeline(),
      forecast: createCollaborationFoundryForecastEnvelope(),
      exceptions: createCollaborationFoundryExceptionLedger(),
      summary: summarizeCollaborationFoundryAnalytics()
    },
    operations: {
      board: createCollaborationFoundryOperationsBoard(),
      checklist: createCollaborationFoundryShiftChecklist(),
      incidents: createCollaborationFoundryIncidentDeck()
    },
    reporting: {
      cards: createCollaborationFoundryReportCards(),
      packets: createCollaborationFoundryReviewPackets(),
      summary: summarizeCollaborationFoundryReporting()
    },
    audit: {
      trail: createCollaborationFoundryAuditTrail(),
      manifest: createCollaborationFoundryEvidenceManifest(),
      attestation: createCollaborationFoundryReadinessAttestation()
    },
    playbooks: createCollaborationFoundryPlaybooks(),
    decisions: createCollaborationFoundryDecisionDeck(),
    escalationMoments: createCollaborationFoundryEscalationMoments()
  };
}

export function createCollaborationFoundryReadinessBoard(snapshot = buildCollaborationFoundrySnapshot()) {
  return [
    { id: 'collaboration-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationFoundryApiDocument(snapshot = buildCollaborationFoundrySnapshot()) {
  return {
    id: 'collaboration-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-foundry/overview' },
      { method: 'GET', path: '/api/collaboration-foundry/reporting' },
      { method: 'POST', path: '/api/collaboration-foundry/validate' },
      { method: 'GET', path: '/api/collaboration-foundry/audit' }
    ],
    readiness: createCollaborationFoundryReadinessBoard(snapshot)
  };
}

export function createCollaborationFoundryRouteSummary(snapshot = buildCollaborationFoundrySnapshot()) {
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

