import fs from 'node:fs';
import path from 'node:path';
import { evaluateArchitectureBudget } from '../architecture-enforcer/index.mjs';
import { collectRepoEvidence, selectPreferredBrowserParity } from '../certification/index.mjs';
import {
  SURFACE_FAMILY_CATALOG,
  TOP_TIER_BROWSER_JOURNEYS,
  ARTIFACT_CLASS_CATALOG,
  ENTERPRISE_FAMILY_IDS,
  ECOSYSTEM_FAMILY_IDS,
  SCALE_OPS_FAMILY_IDS
} from './thresholds.mjs';

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx']);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function sourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function countLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
}

function pathMatches(relPath, patterns = []) {
  const lower = relPath.toLowerCase();
  return patterns.some((pattern) => lower.includes(String(pattern).toLowerCase()));
}

function normalizeArtifactPaths(paths = []) {
  return [...new Set((paths || []).filter(Boolean))];
}

function inventoryFileSets(repoRoot) {
  const all = walk(repoRoot).filter(sourceFile).map((filePath) => ({
    abs: filePath,
    rel: path.relative(repoRoot, filePath),
    lines: countLines(filePath)
  }));
  const productFiles = all.filter((file) => /^(apps|packages|src|services)\//.test(file.rel));
  const testFiles = all.filter((file) => file.rel.startsWith(`tests${path.sep}`));
  const routeFiles = productFiles.filter((file) => file.rel.includes(`${path.sep}routes${path.sep}`));
  const domainFiles = productFiles.filter((file) => /(^|\/)domain[-/]/.test(file.rel) || /domain-/i.test(path.basename(file.rel)));
  return { productFiles, testFiles, routeFiles, domainFiles };
}

function familyCheckIds(paritySection) {
  return (paritySection?.checks || []).map((check) => String(check.id || '')).filter(Boolean);
}

function classifyBrowserJourneyCoverage(parityReport) {
  const checkIds = familyCheckIds(selectPreferredBrowserParity(parityReport));
  const lowerIds = checkIds.map((id) => id.toLowerCase());
  const journeys = TOP_TIER_BROWSER_JOURNEYS.map((journey) => {
    const matchedChecks = checkIds.filter((id, index) => journey.patterns.some((pattern) => lowerIds[index].includes(pattern)));
    return {
      ...journey,
      matchedChecks,
      covered: matchedChecks.length > 0
    };
  });
  return {
    totalChecks: checkIds.length,
    coveredFamilies: journeys.filter((journey) => journey.covered).length,
    coveredJourneyIds: journeys.filter((journey) => journey.covered).map((journey) => journey.id),
    journeys
  };
}

function classifyArtifactClasses(artifactPaths) {
  const normalized = normalizeArtifactPaths(artifactPaths);
  const classes = ARTIFACT_CLASS_CATALOG.map((artifactClass) => {
    const matchedPaths = normalized.filter((filePath) => artifactClass.patterns.some((pattern) => filePath.toLowerCase().includes(pattern.toLowerCase())));
    return {
      ...artifactClass,
      matchedPaths,
      present: matchedPaths.length > 0
    };
  });
  return {
    totalArtifacts: normalized.length,
    presentClasses: classes.filter((entry) => entry.present).length,
    presentClassIds: classes.filter((entry) => entry.present).map((entry) => entry.id),
    classes
  };
}

function summarizeFamilySets(completeIds, ids) {
  const matched = ids.filter((id) => completeIds.has(id));
  return {
    required: ids,
    complete: matched.length,
    completeIds: matched,
    missingIds: ids.filter((id) => !completeIds.has(id))
  };
}

export function collectRepoPathEvidence({
  repoRoot,
  architectureReport = null,
  certification = null,
  parityReport = null,
  evidenceArtifacts = [],
  repoTestsOk = null,
  targetTestsOk = null,
  supervisorOk = null,
  notifyOk = null
} = {}) {
  const architecture = architectureReport || evaluateArchitectureBudget(repoRoot, { claimProfile: 'full_clone_credible' });
  const certificationEvidence = certification?.evidence || {};
  const baseEvidence = collectRepoEvidence(repoRoot, {
    architectureReport: architecture,
    parityReport,
    evidenceArtifacts,
    repoTestsOk: repoTestsOk ?? certificationEvidence.repoTestsOk,
    targetTestsOk: targetTestsOk ?? certificationEvidence.targetTestsOk,
    supervisorOk: supervisorOk ?? certificationEvidence.supervisorOk,
    notifyOk: notifyOk ?? certificationEvidence.notifyOk
  });

  const inventory = inventoryFileSets(repoRoot);
  const routeFiles = inventory.routeFiles.map((file) => file.rel).sort();
  const domainFiles = inventory.domainFiles.map((file) => file.rel).sort();
  const productFiles = inventory.productFiles.map((file) => file.rel).sort();
  const testFiles = inventory.testFiles.map((file) => file.rel).sort();
  const parity = parityReport || {};
  const liveHttp = parity.liveHttp || parity.http || null;
  const browser = selectPreferredBrowserParity(parity);

  const surfaceFamilies = SURFACE_FAMILY_CATALOG.map((family) => {
    const routeMatches = routeFiles.filter((file) => pathMatches(file, family.routePatterns));
    const testMatches = testFiles.filter((file) => pathMatches(file, family.testPatterns));
    const moduleMatches = productFiles.filter((file) => pathMatches(file, family.modulePatterns));
    const evidenceSignals = [routeMatches.length > 0, testMatches.length > 0, moduleMatches.length > 0].filter(Boolean).length;
    return {
      ...family,
      status: evidenceSignals >= 2 ? 'complete' : evidenceSignals === 1 ? 'partial' : 'missing',
      routeMatches,
      testMatches,
      moduleMatches,
      evidenceSignals
    };
  });

  const coverageSummary = {
    complete: surfaceFamilies.filter((family) => family.status === 'complete').length,
    partial: surfaceFamilies.filter((family) => family.status === 'partial').length,
    missing: surfaceFamilies.filter((family) => family.status === 'missing').length,
    completeIds: surfaceFamilies.filter((family) => family.status === 'complete').map((family) => family.id),
    partialIds: surfaceFamilies.filter((family) => family.status === 'partial').map((family) => family.id),
    missingIds: surfaceFamilies.filter((family) => family.status === 'missing').map((family) => family.id)
  };

  const completeIds = new Set(coverageSummary.completeIds);
  const browserCoverage = classifyBrowserJourneyCoverage(parity);
  const artifactCoverage = classifyArtifactClasses(evidenceArtifacts);
  const enterpriseCoverage = summarizeFamilySets(completeIds, ENTERPRISE_FAMILY_IDS);
  const ecosystemCoverage = summarizeFamilySets(completeIds, ECOSYSTEM_FAMILY_IDS);
  const scaleOpsCoverage = summarizeFamilySets(completeIds, SCALE_OPS_FAMILY_IDS);
  const realBrowser = Boolean(baseEvidence.browserEvidence?.real);
  const evidenceRealism = Boolean(
    baseEvidence.parityOk
    && baseEvidence.repoTestsOk
    && baseEvidence.targetTestsOk
    && baseEvidence.supervisorOk
    && baseEvidence.notifyOk
    && artifactCoverage.presentClasses >= 6
  );

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    baseEvidence,
    architecture,
    census: {
      productFiles: baseEvidence.productFiles,
      productLines: baseEvidence.productLines,
      testFiles: baseEvidence.testFiles,
      testLines: baseEvidence.testLines,
      packageCount: architecture?.budget?.metrics?.packageCount || architecture?.metrics?.packageCount || 0,
      appCount: architecture?.budget?.metrics?.appCount || architecture?.metrics?.appCount || 0,
      moduleRoots: architecture?.budget?.metrics?.moduleRoots || architecture?.metrics?.moduleRoots || 0,
      routeFiles: routeFiles.length,
      domainFiles: domainFiles.length,
      surfaceFamiliesComplete: coverageSummary.complete,
      parityChecks: baseEvidence.parityChecks,
      liveHttpChecks: liveHttp?.passed || 0,
      browserChecks: browser?.passed || 0,
      realBrowserChecks: realBrowser ? (browser?.passed || 0) : 0,
      browserJourneyFamilies: realBrowser ? browserCoverage.coveredFamilies : 0,
      integrationSurfaceFamilies: ecosystemCoverage.complete,
      enterpriseSurfaceFamilies: enterpriseCoverage.complete,
      artifactClasses: artifactCoverage.presentClasses,
      evidenceArtifacts: artifactCoverage.totalArtifacts
    },
    qualitative: {
      parityOk: Boolean(baseEvidence.parityOk),
      repoTestsOk: Boolean(baseEvidence.repoTestsOk),
      targetTestsOk: Boolean(baseEvidence.targetTestsOk),
      supervisorOk: Boolean(baseEvidence.supervisorOk),
      notifyOk: Boolean(baseEvidence.notifyOk),
      realBrowser,
      browserDriver: baseEvidence.browserEvidence?.driver || 'none',
      evidenceRealism,
      browserRealismAtScale: Boolean(realBrowser && (browser?.passed || 0) >= 20 && browserCoverage.coveredFamilies >= 4),
      integrationRealism: Boolean(ecosystemCoverage.complete >= 2 && coverageSummary.completeIds.includes('integrations_marketplace')),
      enterpriseReadiness: Boolean(enterpriseCoverage.complete >= 2 && coverageSummary.completeIds.includes('admin_api_ops')),
      scaleOpsRealism: Boolean(scaleOpsCoverage.complete >= 2 && artifactCoverage.presentClasses >= 6 && (liveHttp?.passed || 0) >= 4)
    },
    files: { routeFiles, domainFiles, productFiles, testFiles },
    surfaceFamilies,
    coverageSummary,
    browserCoverage,
    artifactCoverage,
    structuralCoverage: {
      enterprise: enterpriseCoverage,
      ecosystem: ecosystemCoverage,
      scaleOps: scaleOpsCoverage
    },
    truthSummary: certification
      ? {
          requestedClaim: certification.requestedClaim,
          highestAllowedClaim: certification.highestAllowedClaim,
          requestedClaimAllowed: certification.requestedClaimAllowed,
          downgradeReasons: certification.publicSummary?.downgradeReasons || []
        }
      : null
  };
}
