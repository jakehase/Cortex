import { createExperimentationCockpitWorkspace, summarizeExperimentationCockpitWorkspace, createExperimentationCockpitNarratives, createExperimentationCockpitCoverageGrid } from './domain-experimentation-cockpit.mjs';
import { createExperimentationCockpitPolicies, validateExperimentationCockpitPolicies, summarizeExperimentationCockpitPolicies, createExperimentationCockpitEscalationDeck } from './policies-experimentation-cockpit.mjs';
import { createExperimentationCockpitAnalyticsTimeline, createExperimentationCockpitForecastEnvelope, createExperimentationCockpitExceptionLedger, summarizeExperimentationCockpitAnalytics } from './analytics-experimentation-cockpit.mjs';
import { createExperimentationCockpitOperationsBoard, createExperimentationCockpitShiftChecklist, createExperimentationCockpitIncidentDeck } from './operations-experimentation-cockpit.mjs';
import { createExperimentationCockpitReportCards, createExperimentationCockpitReviewPackets, summarizeExperimentationCockpitReporting } from './reporting-experimentation-cockpit.mjs';
import { createExperimentationCockpitAuditTrail, createExperimentationCockpitEvidenceManifest, createExperimentationCockpitReadinessAttestation } from './audit-experimentation-cockpit.mjs';
import { createExperimentationCockpitPlaybooks, createExperimentationCockpitDecisionDeck, createExperimentationCockpitEscalationMoments } from './playbooks-experimentation-cockpit.mjs';

export function buildExperimentationCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationCockpitWorkspace(workspaceName);
  const policies = createExperimentationCockpitPolicies();
  return {
    workspace,
    summary: summarizeExperimentationCockpitWorkspace(workspace),
    narratives: createExperimentationCockpitNarratives(workspace),
    coverage: createExperimentationCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationCockpitPolicies(policies),
    validation: validateExperimentationCockpitPolicies(policies),
    escalationDeck: createExperimentationCockpitEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationCockpitAnalyticsTimeline(),
      forecast: createExperimentationCockpitForecastEnvelope(),
      exceptions: createExperimentationCockpitExceptionLedger(),
      summary: summarizeExperimentationCockpitAnalytics()
    },
    operations: {
      board: createExperimentationCockpitOperationsBoard(),
      checklist: createExperimentationCockpitShiftChecklist(),
      incidents: createExperimentationCockpitIncidentDeck()
    },
    reporting: {
      cards: createExperimentationCockpitReportCards(),
      packets: createExperimentationCockpitReviewPackets(),
      summary: summarizeExperimentationCockpitReporting()
    },
    audit: {
      trail: createExperimentationCockpitAuditTrail(),
      manifest: createExperimentationCockpitEvidenceManifest(),
      attestation: createExperimentationCockpitReadinessAttestation()
    },
    playbooks: createExperimentationCockpitPlaybooks(),
    decisions: createExperimentationCockpitDecisionDeck(),
    escalationMoments: createExperimentationCockpitEscalationMoments()
  };
}

export function createExperimentationCockpitReadinessBoard(snapshot = buildExperimentationCockpitSnapshot()) {
  return [
    { id: 'experimentation-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationCockpitApiDocument(snapshot = buildExperimentationCockpitSnapshot()) {
  return {
    id: 'experimentation-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-cockpit/overview' },
      { method: 'GET', path: '/api/experimentation-cockpit/reporting' },
      { method: 'POST', path: '/api/experimentation-cockpit/validate' },
      { method: 'GET', path: '/api/experimentation-cockpit/audit' }
    ],
    readiness: createExperimentationCockpitReadinessBoard(snapshot)
  };
}

export function createExperimentationCockpitRouteSummary(snapshot = buildExperimentationCockpitSnapshot()) {
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

