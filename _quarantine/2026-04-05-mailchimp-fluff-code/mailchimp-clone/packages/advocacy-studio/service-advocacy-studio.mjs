import { createAdvocacyStudioWorkspace, summarizeAdvocacyStudioWorkspace, createAdvocacyStudioNarratives, createAdvocacyStudioCoverageGrid } from './domain-advocacy-studio.mjs';
import { createAdvocacyStudioPolicies, validateAdvocacyStudioPolicies, summarizeAdvocacyStudioPolicies, createAdvocacyStudioEscalationDeck } from './policies-advocacy-studio.mjs';
import { createAdvocacyStudioAnalyticsTimeline, createAdvocacyStudioForecastEnvelope, createAdvocacyStudioExceptionLedger, summarizeAdvocacyStudioAnalytics } from './analytics-advocacy-studio.mjs';
import { createAdvocacyStudioOperationsBoard, createAdvocacyStudioShiftChecklist, createAdvocacyStudioIncidentDeck } from './operations-advocacy-studio.mjs';
import { createAdvocacyStudioReportCards, createAdvocacyStudioReviewPackets, summarizeAdvocacyStudioReporting } from './reporting-advocacy-studio.mjs';
import { createAdvocacyStudioAuditTrail, createAdvocacyStudioEvidenceManifest, createAdvocacyStudioReadinessAttestation } from './audit-advocacy-studio.mjs';
import { createAdvocacyStudioPlaybooks, createAdvocacyStudioDecisionDeck, createAdvocacyStudioEscalationMoments } from './playbooks-advocacy-studio.mjs';

export function buildAdvocacyStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyStudioWorkspace(workspaceName);
  const policies = createAdvocacyStudioPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyStudioWorkspace(workspace),
    narratives: createAdvocacyStudioNarratives(workspace),
    coverage: createAdvocacyStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyStudioPolicies(policies),
    validation: validateAdvocacyStudioPolicies(policies),
    escalationDeck: createAdvocacyStudioEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyStudioAnalyticsTimeline(),
      forecast: createAdvocacyStudioForecastEnvelope(),
      exceptions: createAdvocacyStudioExceptionLedger(),
      summary: summarizeAdvocacyStudioAnalytics()
    },
    operations: {
      board: createAdvocacyStudioOperationsBoard(),
      checklist: createAdvocacyStudioShiftChecklist(),
      incidents: createAdvocacyStudioIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyStudioReportCards(),
      packets: createAdvocacyStudioReviewPackets(),
      summary: summarizeAdvocacyStudioReporting()
    },
    audit: {
      trail: createAdvocacyStudioAuditTrail(),
      manifest: createAdvocacyStudioEvidenceManifest(),
      attestation: createAdvocacyStudioReadinessAttestation()
    },
    playbooks: createAdvocacyStudioPlaybooks(),
    decisions: createAdvocacyStudioDecisionDeck(),
    escalationMoments: createAdvocacyStudioEscalationMoments()
  };
}

export function createAdvocacyStudioReadinessBoard(snapshot = buildAdvocacyStudioSnapshot()) {
  return [
    { id: 'advocacy-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyStudioApiDocument(snapshot = buildAdvocacyStudioSnapshot()) {
  return {
    id: 'advocacy-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-studio/overview' },
      { method: 'GET', path: '/api/advocacy-studio/reporting' },
      { method: 'POST', path: '/api/advocacy-studio/validate' },
      { method: 'GET', path: '/api/advocacy-studio/audit' }
    ],
    readiness: createAdvocacyStudioReadinessBoard(snapshot)
  };
}

export function createAdvocacyStudioRouteSummary(snapshot = buildAdvocacyStudioSnapshot()) {
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

