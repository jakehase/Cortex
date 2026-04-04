import { createExperimentationFoundryWorkspace, summarizeExperimentationFoundryWorkspace, createExperimentationFoundryNarratives, createExperimentationFoundryCoverageGrid } from './domain-experimentation-foundry.mjs';
import { createExperimentationFoundryPolicies, validateExperimentationFoundryPolicies, summarizeExperimentationFoundryPolicies, createExperimentationFoundryEscalationDeck } from './policies-experimentation-foundry.mjs';
import { createExperimentationFoundryAnalyticsTimeline, createExperimentationFoundryForecastEnvelope, createExperimentationFoundryExceptionLedger, summarizeExperimentationFoundryAnalytics } from './analytics-experimentation-foundry.mjs';
import { createExperimentationFoundryOperationsBoard, createExperimentationFoundryShiftChecklist, createExperimentationFoundryIncidentDeck } from './operations-experimentation-foundry.mjs';
import { createExperimentationFoundryReportCards, createExperimentationFoundryReviewPackets, summarizeExperimentationFoundryReporting } from './reporting-experimentation-foundry.mjs';
import { createExperimentationFoundryAuditTrail, createExperimentationFoundryEvidenceManifest, createExperimentationFoundryReadinessAttestation } from './audit-experimentation-foundry.mjs';
import { createExperimentationFoundryPlaybooks, createExperimentationFoundryDecisionDeck, createExperimentationFoundryEscalationMoments } from './playbooks-experimentation-foundry.mjs';

export function buildExperimentationFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationFoundryWorkspace(workspaceName);
  const policies = createExperimentationFoundryPolicies();
  return {
    workspace,
    summary: summarizeExperimentationFoundryWorkspace(workspace),
    narratives: createExperimentationFoundryNarratives(workspace),
    coverage: createExperimentationFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationFoundryPolicies(policies),
    validation: validateExperimentationFoundryPolicies(policies),
    escalationDeck: createExperimentationFoundryEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationFoundryAnalyticsTimeline(),
      forecast: createExperimentationFoundryForecastEnvelope(),
      exceptions: createExperimentationFoundryExceptionLedger(),
      summary: summarizeExperimentationFoundryAnalytics()
    },
    operations: {
      board: createExperimentationFoundryOperationsBoard(),
      checklist: createExperimentationFoundryShiftChecklist(),
      incidents: createExperimentationFoundryIncidentDeck()
    },
    reporting: {
      cards: createExperimentationFoundryReportCards(),
      packets: createExperimentationFoundryReviewPackets(),
      summary: summarizeExperimentationFoundryReporting()
    },
    audit: {
      trail: createExperimentationFoundryAuditTrail(),
      manifest: createExperimentationFoundryEvidenceManifest(),
      attestation: createExperimentationFoundryReadinessAttestation()
    },
    playbooks: createExperimentationFoundryPlaybooks(),
    decisions: createExperimentationFoundryDecisionDeck(),
    escalationMoments: createExperimentationFoundryEscalationMoments()
  };
}

export function createExperimentationFoundryReadinessBoard(snapshot = buildExperimentationFoundrySnapshot()) {
  return [
    { id: 'experimentation-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationFoundryApiDocument(snapshot = buildExperimentationFoundrySnapshot()) {
  return {
    id: 'experimentation-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-foundry/overview' },
      { method: 'GET', path: '/api/experimentation-foundry/reporting' },
      { method: 'POST', path: '/api/experimentation-foundry/validate' },
      { method: 'GET', path: '/api/experimentation-foundry/audit' }
    ],
    readiness: createExperimentationFoundryReadinessBoard(snapshot)
  };
}

export function createExperimentationFoundryRouteSummary(snapshot = buildExperimentationFoundrySnapshot()) {
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

