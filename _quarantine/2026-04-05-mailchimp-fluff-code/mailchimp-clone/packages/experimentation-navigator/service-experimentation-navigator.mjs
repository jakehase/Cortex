import { createExperimentationNavigatorWorkspace, summarizeExperimentationNavigatorWorkspace, createExperimentationNavigatorNarratives, createExperimentationNavigatorCoverageGrid } from './domain-experimentation-navigator.mjs';
import { createExperimentationNavigatorPolicies, validateExperimentationNavigatorPolicies, summarizeExperimentationNavigatorPolicies, createExperimentationNavigatorEscalationDeck } from './policies-experimentation-navigator.mjs';
import { createExperimentationNavigatorAnalyticsTimeline, createExperimentationNavigatorForecastEnvelope, createExperimentationNavigatorExceptionLedger, summarizeExperimentationNavigatorAnalytics } from './analytics-experimentation-navigator.mjs';
import { createExperimentationNavigatorOperationsBoard, createExperimentationNavigatorShiftChecklist, createExperimentationNavigatorIncidentDeck } from './operations-experimentation-navigator.mjs';
import { createExperimentationNavigatorReportCards, createExperimentationNavigatorReviewPackets, summarizeExperimentationNavigatorReporting } from './reporting-experimentation-navigator.mjs';
import { createExperimentationNavigatorAuditTrail, createExperimentationNavigatorEvidenceManifest, createExperimentationNavigatorReadinessAttestation } from './audit-experimentation-navigator.mjs';
import { createExperimentationNavigatorPlaybooks, createExperimentationNavigatorDecisionDeck, createExperimentationNavigatorEscalationMoments } from './playbooks-experimentation-navigator.mjs';

export function buildExperimentationNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationNavigatorWorkspace(workspaceName);
  const policies = createExperimentationNavigatorPolicies();
  return {
    workspace,
    summary: summarizeExperimentationNavigatorWorkspace(workspace),
    narratives: createExperimentationNavigatorNarratives(workspace),
    coverage: createExperimentationNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationNavigatorPolicies(policies),
    validation: validateExperimentationNavigatorPolicies(policies),
    escalationDeck: createExperimentationNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationNavigatorAnalyticsTimeline(),
      forecast: createExperimentationNavigatorForecastEnvelope(),
      exceptions: createExperimentationNavigatorExceptionLedger(),
      summary: summarizeExperimentationNavigatorAnalytics()
    },
    operations: {
      board: createExperimentationNavigatorOperationsBoard(),
      checklist: createExperimentationNavigatorShiftChecklist(),
      incidents: createExperimentationNavigatorIncidentDeck()
    },
    reporting: {
      cards: createExperimentationNavigatorReportCards(),
      packets: createExperimentationNavigatorReviewPackets(),
      summary: summarizeExperimentationNavigatorReporting()
    },
    audit: {
      trail: createExperimentationNavigatorAuditTrail(),
      manifest: createExperimentationNavigatorEvidenceManifest(),
      attestation: createExperimentationNavigatorReadinessAttestation()
    },
    playbooks: createExperimentationNavigatorPlaybooks(),
    decisions: createExperimentationNavigatorDecisionDeck(),
    escalationMoments: createExperimentationNavigatorEscalationMoments()
  };
}

export function createExperimentationNavigatorReadinessBoard(snapshot = buildExperimentationNavigatorSnapshot()) {
  return [
    { id: 'experimentation-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationNavigatorApiDocument(snapshot = buildExperimentationNavigatorSnapshot()) {
  return {
    id: 'experimentation-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-navigator/overview' },
      { method: 'GET', path: '/api/experimentation-navigator/reporting' },
      { method: 'POST', path: '/api/experimentation-navigator/validate' },
      { method: 'GET', path: '/api/experimentation-navigator/audit' }
    ],
    readiness: createExperimentationNavigatorReadinessBoard(snapshot)
  };
}

export function createExperimentationNavigatorRouteSummary(snapshot = buildExperimentationNavigatorSnapshot()) {
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

