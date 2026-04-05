import { createComplianceFoundryWorkspace, summarizeComplianceFoundryWorkspace, createComplianceFoundryNarratives, createComplianceFoundryCoverageGrid } from './domain-compliance-foundry.mjs';
import { createComplianceFoundryPolicies, validateComplianceFoundryPolicies, summarizeComplianceFoundryPolicies, createComplianceFoundryEscalationDeck } from './policies-compliance-foundry.mjs';
import { createComplianceFoundryAnalyticsTimeline, createComplianceFoundryForecastEnvelope, createComplianceFoundryExceptionLedger, summarizeComplianceFoundryAnalytics } from './analytics-compliance-foundry.mjs';
import { createComplianceFoundryOperationsBoard, createComplianceFoundryShiftChecklist, createComplianceFoundryIncidentDeck } from './operations-compliance-foundry.mjs';
import { createComplianceFoundryReportCards, createComplianceFoundryReviewPackets, summarizeComplianceFoundryReporting } from './reporting-compliance-foundry.mjs';
import { createComplianceFoundryAuditTrail, createComplianceFoundryEvidenceManifest, createComplianceFoundryReadinessAttestation } from './audit-compliance-foundry.mjs';
import { createComplianceFoundryPlaybooks, createComplianceFoundryDecisionDeck, createComplianceFoundryEscalationMoments } from './playbooks-compliance-foundry.mjs';

export function buildComplianceFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceFoundryWorkspace(workspaceName);
  const policies = createComplianceFoundryPolicies();
  return {
    workspace,
    summary: summarizeComplianceFoundryWorkspace(workspace),
    narratives: createComplianceFoundryNarratives(workspace),
    coverage: createComplianceFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceFoundryPolicies(policies),
    validation: validateComplianceFoundryPolicies(policies),
    escalationDeck: createComplianceFoundryEscalationDeck(policies),
    analytics: {
      timeline: createComplianceFoundryAnalyticsTimeline(),
      forecast: createComplianceFoundryForecastEnvelope(),
      exceptions: createComplianceFoundryExceptionLedger(),
      summary: summarizeComplianceFoundryAnalytics()
    },
    operations: {
      board: createComplianceFoundryOperationsBoard(),
      checklist: createComplianceFoundryShiftChecklist(),
      incidents: createComplianceFoundryIncidentDeck()
    },
    reporting: {
      cards: createComplianceFoundryReportCards(),
      packets: createComplianceFoundryReviewPackets(),
      summary: summarizeComplianceFoundryReporting()
    },
    audit: {
      trail: createComplianceFoundryAuditTrail(),
      manifest: createComplianceFoundryEvidenceManifest(),
      attestation: createComplianceFoundryReadinessAttestation()
    },
    playbooks: createComplianceFoundryPlaybooks(),
    decisions: createComplianceFoundryDecisionDeck(),
    escalationMoments: createComplianceFoundryEscalationMoments()
  };
}

export function createComplianceFoundryReadinessBoard(snapshot = buildComplianceFoundrySnapshot()) {
  return [
    { id: 'compliance-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceFoundryApiDocument(snapshot = buildComplianceFoundrySnapshot()) {
  return {
    id: 'compliance-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-foundry/overview' },
      { method: 'GET', path: '/api/compliance-foundry/reporting' },
      { method: 'POST', path: '/api/compliance-foundry/validate' },
      { method: 'GET', path: '/api/compliance-foundry/audit' }
    ],
    readiness: createComplianceFoundryReadinessBoard(snapshot)
  };
}

export function createComplianceFoundryRouteSummary(snapshot = buildComplianceFoundrySnapshot()) {
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

