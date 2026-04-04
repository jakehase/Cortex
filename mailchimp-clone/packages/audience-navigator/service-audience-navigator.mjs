import { createAudienceNavigatorWorkspace, summarizeAudienceNavigatorWorkspace, createAudienceNavigatorNarratives, createAudienceNavigatorCoverageGrid } from './domain-audience-navigator.mjs';
import { createAudienceNavigatorPolicies, validateAudienceNavigatorPolicies, summarizeAudienceNavigatorPolicies, createAudienceNavigatorEscalationDeck } from './policies-audience-navigator.mjs';
import { createAudienceNavigatorAnalyticsTimeline, createAudienceNavigatorForecastEnvelope, createAudienceNavigatorExceptionLedger, summarizeAudienceNavigatorAnalytics } from './analytics-audience-navigator.mjs';
import { createAudienceNavigatorOperationsBoard, createAudienceNavigatorShiftChecklist, createAudienceNavigatorIncidentDeck } from './operations-audience-navigator.mjs';
import { createAudienceNavigatorReportCards, createAudienceNavigatorReviewPackets, summarizeAudienceNavigatorReporting } from './reporting-audience-navigator.mjs';
import { createAudienceNavigatorAuditTrail, createAudienceNavigatorEvidenceManifest, createAudienceNavigatorReadinessAttestation } from './audit-audience-navigator.mjs';
import { createAudienceNavigatorPlaybooks, createAudienceNavigatorDecisionDeck, createAudienceNavigatorEscalationMoments } from './playbooks-audience-navigator.mjs';

export function buildAudienceNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceNavigatorWorkspace(workspaceName);
  const policies = createAudienceNavigatorPolicies();
  return {
    workspace,
    summary: summarizeAudienceNavigatorWorkspace(workspace),
    narratives: createAudienceNavigatorNarratives(workspace),
    coverage: createAudienceNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceNavigatorPolicies(policies),
    validation: validateAudienceNavigatorPolicies(policies),
    escalationDeck: createAudienceNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createAudienceNavigatorAnalyticsTimeline(),
      forecast: createAudienceNavigatorForecastEnvelope(),
      exceptions: createAudienceNavigatorExceptionLedger(),
      summary: summarizeAudienceNavigatorAnalytics()
    },
    operations: {
      board: createAudienceNavigatorOperationsBoard(),
      checklist: createAudienceNavigatorShiftChecklist(),
      incidents: createAudienceNavigatorIncidentDeck()
    },
    reporting: {
      cards: createAudienceNavigatorReportCards(),
      packets: createAudienceNavigatorReviewPackets(),
      summary: summarizeAudienceNavigatorReporting()
    },
    audit: {
      trail: createAudienceNavigatorAuditTrail(),
      manifest: createAudienceNavigatorEvidenceManifest(),
      attestation: createAudienceNavigatorReadinessAttestation()
    },
    playbooks: createAudienceNavigatorPlaybooks(),
    decisions: createAudienceNavigatorDecisionDeck(),
    escalationMoments: createAudienceNavigatorEscalationMoments()
  };
}

export function createAudienceNavigatorReadinessBoard(snapshot = buildAudienceNavigatorSnapshot()) {
  return [
    { id: 'audience-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceNavigatorApiDocument(snapshot = buildAudienceNavigatorSnapshot()) {
  return {
    id: 'audience-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-navigator/overview' },
      { method: 'GET', path: '/api/audience-navigator/reporting' },
      { method: 'POST', path: '/api/audience-navigator/validate' },
      { method: 'GET', path: '/api/audience-navigator/audit' }
    ],
    readiness: createAudienceNavigatorReadinessBoard(snapshot)
  };
}

export function createAudienceNavigatorRouteSummary(snapshot = buildAudienceNavigatorSnapshot()) {
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

