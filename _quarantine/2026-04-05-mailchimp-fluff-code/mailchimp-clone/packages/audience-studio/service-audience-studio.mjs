import { createAudienceStudioWorkspace, summarizeAudienceStudioWorkspace, createAudienceStudioNarratives, createAudienceStudioCoverageGrid } from './domain-audience-studio.mjs';
import { createAudienceStudioPolicies, validateAudienceStudioPolicies, summarizeAudienceStudioPolicies, createAudienceStudioEscalationDeck } from './policies-audience-studio.mjs';
import { createAudienceStudioAnalyticsTimeline, createAudienceStudioForecastEnvelope, createAudienceStudioExceptionLedger, summarizeAudienceStudioAnalytics } from './analytics-audience-studio.mjs';
import { createAudienceStudioOperationsBoard, createAudienceStudioShiftChecklist, createAudienceStudioIncidentDeck } from './operations-audience-studio.mjs';
import { createAudienceStudioReportCards, createAudienceStudioReviewPackets, summarizeAudienceStudioReporting } from './reporting-audience-studio.mjs';
import { createAudienceStudioAuditTrail, createAudienceStudioEvidenceManifest, createAudienceStudioReadinessAttestation } from './audit-audience-studio.mjs';
import { createAudienceStudioPlaybooks, createAudienceStudioDecisionDeck, createAudienceStudioEscalationMoments } from './playbooks-audience-studio.mjs';

export function buildAudienceStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceStudioWorkspace(workspaceName);
  const policies = createAudienceStudioPolicies();
  return {
    workspace,
    summary: summarizeAudienceStudioWorkspace(workspace),
    narratives: createAudienceStudioNarratives(workspace),
    coverage: createAudienceStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceStudioPolicies(policies),
    validation: validateAudienceStudioPolicies(policies),
    escalationDeck: createAudienceStudioEscalationDeck(policies),
    analytics: {
      timeline: createAudienceStudioAnalyticsTimeline(),
      forecast: createAudienceStudioForecastEnvelope(),
      exceptions: createAudienceStudioExceptionLedger(),
      summary: summarizeAudienceStudioAnalytics()
    },
    operations: {
      board: createAudienceStudioOperationsBoard(),
      checklist: createAudienceStudioShiftChecklist(),
      incidents: createAudienceStudioIncidentDeck()
    },
    reporting: {
      cards: createAudienceStudioReportCards(),
      packets: createAudienceStudioReviewPackets(),
      summary: summarizeAudienceStudioReporting()
    },
    audit: {
      trail: createAudienceStudioAuditTrail(),
      manifest: createAudienceStudioEvidenceManifest(),
      attestation: createAudienceStudioReadinessAttestation()
    },
    playbooks: createAudienceStudioPlaybooks(),
    decisions: createAudienceStudioDecisionDeck(),
    escalationMoments: createAudienceStudioEscalationMoments()
  };
}

export function createAudienceStudioReadinessBoard(snapshot = buildAudienceStudioSnapshot()) {
  return [
    { id: 'audience-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceStudioApiDocument(snapshot = buildAudienceStudioSnapshot()) {
  return {
    id: 'audience-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-studio/overview' },
      { method: 'GET', path: '/api/audience-studio/reporting' },
      { method: 'POST', path: '/api/audience-studio/validate' },
      { method: 'GET', path: '/api/audience-studio/audit' }
    ],
    readiness: createAudienceStudioReadinessBoard(snapshot)
  };
}

export function createAudienceStudioRouteSummary(snapshot = buildAudienceStudioSnapshot()) {
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

