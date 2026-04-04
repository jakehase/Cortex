import { createComplianceDossierWorkspace, summarizeComplianceDossierWorkspace, createComplianceDossierNarratives, createComplianceDossierCoverageGrid } from './domain-compliance-dossier.mjs';
import { createComplianceDossierPolicies, validateComplianceDossierPolicies, summarizeComplianceDossierPolicies, createComplianceDossierEscalationDeck } from './policies-compliance-dossier.mjs';
import { createComplianceDossierAnalyticsTimeline, createComplianceDossierForecastEnvelope, createComplianceDossierExceptionLedger, summarizeComplianceDossierAnalytics } from './analytics-compliance-dossier.mjs';
import { createComplianceDossierOperationsBoard, createComplianceDossierShiftChecklist, createComplianceDossierIncidentDeck } from './operations-compliance-dossier.mjs';
import { createComplianceDossierReportCards, createComplianceDossierReviewPackets, summarizeComplianceDossierReporting } from './reporting-compliance-dossier.mjs';
import { createComplianceDossierAuditTrail, createComplianceDossierEvidenceManifest, createComplianceDossierReadinessAttestation } from './audit-compliance-dossier.mjs';
import { createComplianceDossierPlaybooks, createComplianceDossierDecisionDeck, createComplianceDossierEscalationMoments } from './playbooks-compliance-dossier.mjs';

export function buildComplianceDossierSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceDossierWorkspace(workspaceName);
  const policies = createComplianceDossierPolicies();
  return {
    workspace,
    summary: summarizeComplianceDossierWorkspace(workspace),
    narratives: createComplianceDossierNarratives(workspace),
    coverage: createComplianceDossierCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceDossierPolicies(policies),
    validation: validateComplianceDossierPolicies(policies),
    escalationDeck: createComplianceDossierEscalationDeck(policies),
    analytics: {
      timeline: createComplianceDossierAnalyticsTimeline(),
      forecast: createComplianceDossierForecastEnvelope(),
      exceptions: createComplianceDossierExceptionLedger(),
      summary: summarizeComplianceDossierAnalytics()
    },
    operations: {
      board: createComplianceDossierOperationsBoard(),
      checklist: createComplianceDossierShiftChecklist(),
      incidents: createComplianceDossierIncidentDeck()
    },
    reporting: {
      cards: createComplianceDossierReportCards(),
      packets: createComplianceDossierReviewPackets(),
      summary: summarizeComplianceDossierReporting()
    },
    audit: {
      trail: createComplianceDossierAuditTrail(),
      manifest: createComplianceDossierEvidenceManifest(),
      attestation: createComplianceDossierReadinessAttestation()
    },
    playbooks: createComplianceDossierPlaybooks(),
    decisions: createComplianceDossierDecisionDeck(),
    escalationMoments: createComplianceDossierEscalationMoments()
  };
}

export function createComplianceDossierReadinessBoard(snapshot = buildComplianceDossierSnapshot()) {
  return [
    { id: 'compliance-dossier-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-dossier-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-dossier-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-dossier-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceDossierApiDocument(snapshot = buildComplianceDossierSnapshot()) {
  return {
    id: 'compliance-dossier-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-dossier/overview' },
      { method: 'GET', path: '/api/compliance-dossier/reporting' },
      { method: 'POST', path: '/api/compliance-dossier/validate' },
      { method: 'GET', path: '/api/compliance-dossier/audit' }
    ],
    readiness: createComplianceDossierReadinessBoard(snapshot)
  };
}

export function createComplianceDossierRouteSummary(snapshot = buildComplianceDossierSnapshot()) {
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

