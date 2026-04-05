import { createLocalizationAdvisorWorkspace, summarizeLocalizationAdvisorWorkspace, createLocalizationAdvisorNarratives, createLocalizationAdvisorCoverageGrid } from './domain-localization-advisor.mjs';
import { createLocalizationAdvisorPolicies, validateLocalizationAdvisorPolicies, summarizeLocalizationAdvisorPolicies, createLocalizationAdvisorEscalationDeck } from './policies-localization-advisor.mjs';
import { createLocalizationAdvisorAnalyticsTimeline, createLocalizationAdvisorForecastEnvelope, createLocalizationAdvisorExceptionLedger, summarizeLocalizationAdvisorAnalytics } from './analytics-localization-advisor.mjs';
import { createLocalizationAdvisorOperationsBoard, createLocalizationAdvisorShiftChecklist, createLocalizationAdvisorIncidentDeck } from './operations-localization-advisor.mjs';
import { createLocalizationAdvisorReportCards, createLocalizationAdvisorReviewPackets, summarizeLocalizationAdvisorReporting } from './reporting-localization-advisor.mjs';
import { createLocalizationAdvisorAuditTrail, createLocalizationAdvisorEvidenceManifest, createLocalizationAdvisorReadinessAttestation } from './audit-localization-advisor.mjs';
import { createLocalizationAdvisorPlaybooks, createLocalizationAdvisorDecisionDeck, createLocalizationAdvisorEscalationMoments } from './playbooks-localization-advisor.mjs';

export function buildLocalizationAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationAdvisorWorkspace(workspaceName);
  const policies = createLocalizationAdvisorPolicies();
  return {
    workspace,
    summary: summarizeLocalizationAdvisorWorkspace(workspace),
    narratives: createLocalizationAdvisorNarratives(workspace),
    coverage: createLocalizationAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationAdvisorPolicies(policies),
    validation: validateLocalizationAdvisorPolicies(policies),
    escalationDeck: createLocalizationAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationAdvisorAnalyticsTimeline(),
      forecast: createLocalizationAdvisorForecastEnvelope(),
      exceptions: createLocalizationAdvisorExceptionLedger(),
      summary: summarizeLocalizationAdvisorAnalytics()
    },
    operations: {
      board: createLocalizationAdvisorOperationsBoard(),
      checklist: createLocalizationAdvisorShiftChecklist(),
      incidents: createLocalizationAdvisorIncidentDeck()
    },
    reporting: {
      cards: createLocalizationAdvisorReportCards(),
      packets: createLocalizationAdvisorReviewPackets(),
      summary: summarizeLocalizationAdvisorReporting()
    },
    audit: {
      trail: createLocalizationAdvisorAuditTrail(),
      manifest: createLocalizationAdvisorEvidenceManifest(),
      attestation: createLocalizationAdvisorReadinessAttestation()
    },
    playbooks: createLocalizationAdvisorPlaybooks(),
    decisions: createLocalizationAdvisorDecisionDeck(),
    escalationMoments: createLocalizationAdvisorEscalationMoments()
  };
}

export function createLocalizationAdvisorReadinessBoard(snapshot = buildLocalizationAdvisorSnapshot()) {
  return [
    { id: 'localization-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationAdvisorApiDocument(snapshot = buildLocalizationAdvisorSnapshot()) {
  return {
    id: 'localization-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-advisor/overview' },
      { method: 'GET', path: '/api/localization-advisor/reporting' },
      { method: 'POST', path: '/api/localization-advisor/validate' },
      { method: 'GET', path: '/api/localization-advisor/audit' }
    ],
    readiness: createLocalizationAdvisorReadinessBoard(snapshot)
  };
}

export function createLocalizationAdvisorRouteSummary(snapshot = buildLocalizationAdvisorSnapshot()) {
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

