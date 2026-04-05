import { createLifecycleFoundryWorkspace, summarizeLifecycleFoundryWorkspace, createLifecycleFoundryNarratives, createLifecycleFoundryCoverageGrid } from './domain-lifecycle-foundry.mjs';
import { createLifecycleFoundryPolicies, validateLifecycleFoundryPolicies, summarizeLifecycleFoundryPolicies, createLifecycleFoundryEscalationDeck } from './policies-lifecycle-foundry.mjs';
import { createLifecycleFoundryAnalyticsTimeline, createLifecycleFoundryForecastEnvelope, createLifecycleFoundryExceptionLedger, summarizeLifecycleFoundryAnalytics } from './analytics-lifecycle-foundry.mjs';
import { createLifecycleFoundryOperationsBoard, createLifecycleFoundryShiftChecklist, createLifecycleFoundryIncidentDeck } from './operations-lifecycle-foundry.mjs';
import { createLifecycleFoundryReportCards, createLifecycleFoundryReviewPackets, summarizeLifecycleFoundryReporting } from './reporting-lifecycle-foundry.mjs';
import { createLifecycleFoundryAuditTrail, createLifecycleFoundryEvidenceManifest, createLifecycleFoundryReadinessAttestation } from './audit-lifecycle-foundry.mjs';
import { createLifecycleFoundryPlaybooks, createLifecycleFoundryDecisionDeck, createLifecycleFoundryEscalationMoments } from './playbooks-lifecycle-foundry.mjs';

export function buildLifecycleFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleFoundryWorkspace(workspaceName);
  const policies = createLifecycleFoundryPolicies();
  return {
    workspace,
    summary: summarizeLifecycleFoundryWorkspace(workspace),
    narratives: createLifecycleFoundryNarratives(workspace),
    coverage: createLifecycleFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleFoundryPolicies(policies),
    validation: validateLifecycleFoundryPolicies(policies),
    escalationDeck: createLifecycleFoundryEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleFoundryAnalyticsTimeline(),
      forecast: createLifecycleFoundryForecastEnvelope(),
      exceptions: createLifecycleFoundryExceptionLedger(),
      summary: summarizeLifecycleFoundryAnalytics()
    },
    operations: {
      board: createLifecycleFoundryOperationsBoard(),
      checklist: createLifecycleFoundryShiftChecklist(),
      incidents: createLifecycleFoundryIncidentDeck()
    },
    reporting: {
      cards: createLifecycleFoundryReportCards(),
      packets: createLifecycleFoundryReviewPackets(),
      summary: summarizeLifecycleFoundryReporting()
    },
    audit: {
      trail: createLifecycleFoundryAuditTrail(),
      manifest: createLifecycleFoundryEvidenceManifest(),
      attestation: createLifecycleFoundryReadinessAttestation()
    },
    playbooks: createLifecycleFoundryPlaybooks(),
    decisions: createLifecycleFoundryDecisionDeck(),
    escalationMoments: createLifecycleFoundryEscalationMoments()
  };
}

export function createLifecycleFoundryReadinessBoard(snapshot = buildLifecycleFoundrySnapshot()) {
  return [
    { id: 'lifecycle-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleFoundryApiDocument(snapshot = buildLifecycleFoundrySnapshot()) {
  return {
    id: 'lifecycle-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-foundry/overview' },
      { method: 'GET', path: '/api/lifecycle-foundry/reporting' },
      { method: 'POST', path: '/api/lifecycle-foundry/validate' },
      { method: 'GET', path: '/api/lifecycle-foundry/audit' }
    ],
    readiness: createLifecycleFoundryReadinessBoard(snapshot)
  };
}

export function createLifecycleFoundryRouteSummary(snapshot = buildLifecycleFoundrySnapshot()) {
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

