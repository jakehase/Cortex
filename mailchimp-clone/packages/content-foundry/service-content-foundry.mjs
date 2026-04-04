import { createContentFoundryWorkspace, summarizeContentFoundryWorkspace, createContentFoundryNarratives, createContentFoundryCoverageGrid } from './domain-content-foundry.mjs';
import { createContentFoundryPolicies, validateContentFoundryPolicies, summarizeContentFoundryPolicies, createContentFoundryEscalationDeck } from './policies-content-foundry.mjs';
import { createContentFoundryAnalyticsTimeline, createContentFoundryForecastEnvelope, createContentFoundryExceptionLedger, summarizeContentFoundryAnalytics } from './analytics-content-foundry.mjs';
import { createContentFoundryOperationsBoard, createContentFoundryShiftChecklist, createContentFoundryIncidentDeck } from './operations-content-foundry.mjs';
import { createContentFoundryReportCards, createContentFoundryReviewPackets, summarizeContentFoundryReporting } from './reporting-content-foundry.mjs';
import { createContentFoundryAuditTrail, createContentFoundryEvidenceManifest, createContentFoundryReadinessAttestation } from './audit-content-foundry.mjs';
import { createContentFoundryPlaybooks, createContentFoundryDecisionDeck, createContentFoundryEscalationMoments } from './playbooks-content-foundry.mjs';

export function buildContentFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentFoundryWorkspace(workspaceName);
  const policies = createContentFoundryPolicies();
  return {
    workspace,
    summary: summarizeContentFoundryWorkspace(workspace),
    narratives: createContentFoundryNarratives(workspace),
    coverage: createContentFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentFoundryPolicies(policies),
    validation: validateContentFoundryPolicies(policies),
    escalationDeck: createContentFoundryEscalationDeck(policies),
    analytics: {
      timeline: createContentFoundryAnalyticsTimeline(),
      forecast: createContentFoundryForecastEnvelope(),
      exceptions: createContentFoundryExceptionLedger(),
      summary: summarizeContentFoundryAnalytics()
    },
    operations: {
      board: createContentFoundryOperationsBoard(),
      checklist: createContentFoundryShiftChecklist(),
      incidents: createContentFoundryIncidentDeck()
    },
    reporting: {
      cards: createContentFoundryReportCards(),
      packets: createContentFoundryReviewPackets(),
      summary: summarizeContentFoundryReporting()
    },
    audit: {
      trail: createContentFoundryAuditTrail(),
      manifest: createContentFoundryEvidenceManifest(),
      attestation: createContentFoundryReadinessAttestation()
    },
    playbooks: createContentFoundryPlaybooks(),
    decisions: createContentFoundryDecisionDeck(),
    escalationMoments: createContentFoundryEscalationMoments()
  };
}

export function createContentFoundryReadinessBoard(snapshot = buildContentFoundrySnapshot()) {
  return [
    { id: 'content-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentFoundryApiDocument(snapshot = buildContentFoundrySnapshot()) {
  return {
    id: 'content-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-foundry/overview' },
      { method: 'GET', path: '/api/content-foundry/reporting' },
      { method: 'POST', path: '/api/content-foundry/validate' },
      { method: 'GET', path: '/api/content-foundry/audit' }
    ],
    readiness: createContentFoundryReadinessBoard(snapshot)
  };
}

export function createContentFoundryRouteSummary(snapshot = buildContentFoundrySnapshot()) {
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

