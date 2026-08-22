import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DEFAULTS = {
  requiredTopLevelDirs: ['apps', 'packages', 'tests', 'docs', 'artifacts'],
  sourceExtensions: new Set(['.js', '.mjs']),
  maxSourceLines: 400,
  enforceMaxSourceLines: false,
  surfaceHonestyManifest: 'surface-honesty.json',
  allowedChangedSurfaceStatuses: new Set(['real']),
  bannedPlaceholderPhrases: [
    /coming soon/i,
    /\bplaceholder\b/i,
    /\bstub\b/i,
    /\bmock\b/i,
    /\bfake\b/i,
    /\bsimulated?\b/i,
    /\bto do\b/i,
    /\bTODO\b/
  ],
  claimThresholds: {
    production_slice: { productFiles: 5, productSourceLines: 400, testFiles: 2 },
    scoped_parity: { productFiles: 12, productSourceLines: 1500, testFiles: 5, packageCount: 2 },
    full_clone_credible: { productFiles: 30, productSourceLines: 12000, testFiles: 10, packageCount: 4 },
    large_product_replica: { productFiles: 250, productSourceLines: 750000, testFiles: 80, packageCount: 20 },
    real_world_indistinguishable: { productFiles: 500, productSourceLines: 1500000, testFiles: 150, packageCount: 40 }
  }
};

const DEFAULT_SURFACE_HONESTY_POLICY = {
  changedProductFilesMustBeDeclared: true,
  allowedChangedStatuses: ['real'],
  requireEvidenceTests: true,
  bannedPlaceholderLanguage: ['coming soon', 'placeholder', 'stub', 'mock', 'fake', 'simulated', 'TODO'],
  bootstrapStatus: 'declare_me'
};

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'artifacts', 'docs', 'data', 'tmp', 'coverage', '.next'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function listImmediateDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sourceFiles(repoRoot, config) {
  const root = path.resolve(repoRoot);
  return walk(root)
    .filter((file) => config.sourceExtensions.has(path.extname(file)))
    .filter((file) => {
      const rel = path.relative(root, file);
      return !rel.split(path.sep).includes('artifacts') && !rel.split(path.sep).includes('docs');
    });
}

function topLevelBucket(rel) {
  return rel.split(path.sep)[0] || '.';
}

function countLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function repoTopLevel(repoRoot) {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return repoRoot;
  }
}

function listChangedProductFiles(repoRoot, config) {
  try {
    const top = repoTopLevel(repoRoot);
    const output = execSync('git status --porcelain -uall', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const seen = new Set();
    for (const rawLine of output.split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      let relFromTop = rawLine.slice(3).trim();
      if (relFromTop.includes(' -> ')) relFromTop = relFromTop.split(' -> ').pop().trim();
      const absolute = path.resolve(top, relFromTop);
      if (!(absolute === repoRoot || absolute.startsWith(`${repoRoot}${path.sep}`))) continue;
      const rel = path.relative(repoRoot, absolute);
      if (!config.sourceExtensions.has(path.extname(rel))) continue;
      if (!productBuckets(rel)) continue;
      seen.add(rel);
    }
    return [...seen].sort();
  } catch {
    return [];
  }
}

function stripAllowedPlaceholderAttributes(text) {
  return text
    .replace(/placeholder\s*=\s*"[^"]*"/gi, '')
    .replace(/placeholder\s*=\s*'[^']*'/gi, '')
    .replace(/placeholder\s*=\s*\{[^}]*\}/gi, '');
}

function humanizeSurfaceLabel(rel) {
  return rel
    .replace(/\.[^.]+$/, '')
    .split(/[\/._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function bootstrapSurfaceEntry(rel, config) {
  return {
    label: humanizeSurfaceLabel(rel),
    status: DEFAULT_SURFACE_HONESTY_POLICY.bootstrapStatus,
    evidence: { tests: [] },
    notes: `Bootstrapped automatically by architecture-enforcer. Replace ${DEFAULT_SURFACE_HONESTY_POLICY.bootstrapStatus} with a truthful status and add evidence before claiming completion.`
  };
}

export function bootstrapSurfaceHonestyManifest(repoRoot, overrides = {}) {
  const config = {
    ...DEFAULTS,
    ...overrides,
    sourceExtensions: overrides.sourceExtensions || DEFAULTS.sourceExtensions,
    claimThresholds: { ...DEFAULTS.claimThresholds, ...(overrides.claimThresholds || {}) }
  };
  const manifestPath = path.join(repoRoot, config.surfaceHonestyManifest);
  const changedProductFiles = listChangedProductFiles(repoRoot, config);
  const existing = readJsonIfExists(manifestPath, null);
  const manifest = existing || {
    version: 1,
    policy: { ...DEFAULT_SURFACE_HONESTY_POLICY },
    surfaces: {}
  };
  manifest.policy = { ...DEFAULT_SURFACE_HONESTY_POLICY, ...(manifest.policy || {}) };
  manifest.surfaces = manifest.surfaces || {};
  let changed = !existing;
  for (const rel of changedProductFiles) {
    if (!manifest.surfaces[rel]) {
      manifest.surfaces[rel] = bootstrapSurfaceEntry(rel, config);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return { created: !existing, updated: changed, manifestPath, changedProductFiles, manifest };
}

function evaluateSurfaceHonesty(repoRoot, config) {
  const manifestPath = path.join(repoRoot, config.surfaceHonestyManifest);
  const manifest = readJsonIfExists(manifestPath, { version: 1, policy: {}, surfaces: {} });
  const changedProductFiles = listChangedProductFiles(repoRoot, config);
  const violations = [];
  const surfaces = manifest?.surfaces || {};
  for (const rel of changedProductFiles) {
    const entry = surfaces[rel];
    if (!entry) {
      violations.push({ rule: 'surface-honesty-missing', path: rel, message: `Changed product file must be declared in ${config.surfaceHonestyManifest}` });
      continue;
    }
    if (!config.allowedChangedSurfaceStatuses.has(entry.status)) {
      violations.push({ rule: 'surface-honesty-status', path: rel, message: `Changed product file status must be one of ${[...config.allowedChangedSurfaceStatuses].join(', ')}; got ${entry.status || 'missing'}` });
    }
    if (!entry.evidence || !Array.isArray(entry.evidence.tests) || entry.evidence.tests.length === 0) {
      violations.push({ rule: 'surface-honesty-evidence', path: rel, message: 'Changed real product files must declare evidence.tests entries' });
    }

    const filePath = path.join(repoRoot, rel);
    const text = stripAllowedPlaceholderAttributes(fs.readFileSync(filePath, 'utf8'));
    for (const pattern of config.bannedPlaceholderPhrases) {
      if (pattern.test(text)) {
        violations.push({ rule: 'surface-honesty-placeholder-copy', path: rel, message: `Changed product file contains banned placeholder-like language matching ${pattern}` });
      }
    }
  }

  return {
    ok: violations.length === 0,
    manifestPath,
    changedProductFiles,
    manifest,
    violations
  };
}

function scoreDimension(value, thresholds) {
  let score = 0;
  for (const threshold of thresholds) {
    if (value >= threshold) score += 1;
  }
  return score;
}

function productBuckets(rel) {
  const first = topLevelBucket(rel);
  return ['apps', 'packages', 'src', 'services'].includes(first);
}

function evaluateClaimBudget(metrics, profile, thresholds) {
  const required = thresholds[profile];
  const reasons = [];
  if (!required) return { eligible: false, reasons: [`Unknown claim profile ${profile}`] };

  if (metrics.productFiles < required.productFiles) reasons.push(`product_files_below_${required.productFiles}`);
  if (metrics.productSourceLines < required.productSourceLines) reasons.push(`product_source_lines_below_${required.productSourceLines}`);
  if (metrics.testFiles < required.testFiles) reasons.push(`test_files_below_${required.testFiles}`);
  if ((required.packageCount || 0) > 0 && metrics.packageCount < required.packageCount) reasons.push(`package_count_below_${required.packageCount}`);
  if (!metrics.separation.hasApps) reasons.push('missing_apps_directory');
  if (!metrics.separation.hasPackages) reasons.push('missing_packages_directory');
  if (!metrics.separation.hasTests) reasons.push('missing_tests_directory');
  if (profile !== 'production_slice' && !metrics.separation.hasRoutesDir) reasons.push('missing_route_separation');
  if (profile !== 'production_slice' && !metrics.separation.hasDomainFiles) reasons.push('missing_domain_split');
  if (metrics.maxProductFileLines > metrics.maxSourceLines) reasons.push(`single_file_exceeds_${metrics.maxSourceLines}`);
  if (profile === 'full_clone_credible' || profile === 'real_world_indistinguishable') {
    if (!metrics.separation.hasDocs) reasons.push('missing_docs_directory');
    if (!metrics.separation.hasArtifacts) reasons.push('missing_artifacts_directory');
    if (metrics.moduleRoots < required.packageCount) reasons.push(`module_roots_below_${required.packageCount}`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateArchitectureBudget(repoRoot, overrides = {}) {
  const config = {
    ...DEFAULTS,
    ...overrides,
    sourceExtensions: overrides.sourceExtensions || DEFAULTS.sourceExtensions,
    claimThresholds: { ...DEFAULTS.claimThresholds, ...(overrides.claimThresholds || {}) }
  };

  const files = sourceFiles(repoRoot, config);
  const metrics = {
    repoRoot,
    packageCount: listImmediateDirs(path.join(repoRoot, 'packages')).length,
    appCount: listImmediateDirs(path.join(repoRoot, 'apps')).length,
    productFiles: 0,
    productSourceLines: 0,
    productDirs: new Set(),
    testFiles: 0,
    testSourceLines: 0,
    maxProductFileLines: 0,
    maxSourceLines: config.maxSourceLines,
    topLevelDirsPresent: config.requiredTopLevelDirs.filter((dir) => fs.existsSync(path.join(repoRoot, dir))),
    separation: {
      hasApps: fs.existsSync(path.join(repoRoot, 'apps')),
      hasPackages: fs.existsSync(path.join(repoRoot, 'packages')),
      hasTests: fs.existsSync(path.join(repoRoot, 'tests')),
      hasDocs: fs.existsSync(path.join(repoRoot, 'docs')),
      hasArtifacts: fs.existsSync(path.join(repoRoot, 'artifacts')),
      hasRoutesDir: false,
      hasDomainFiles: false,
      hasSrc: fs.existsSync(path.join(repoRoot, 'src'))
    }
  };

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = countLines(file);
    if (rel.startsWith(`tests${path.sep}`)) {
      metrics.testFiles += 1;
      metrics.testSourceLines += lines;
      continue;
    }
    if (!productBuckets(rel)) continue;
    metrics.productFiles += 1;
    metrics.productSourceLines += lines;
    metrics.productDirs.add(path.dirname(rel));
    metrics.maxProductFileLines = Math.max(metrics.maxProductFileLines, lines);
    if (rel.includes(`${path.sep}routes${path.sep}`)) metrics.separation.hasRoutesDir = true;
    if (/domain/i.test(path.basename(rel)) || rel.includes(`${path.sep}domain${path.sep}`)) metrics.separation.hasDomainFiles = true;
  }

  const moduleRoots = new Set();
  for (const relDir of metrics.productDirs) {
    const parts = relDir.split(path.sep);
    if (parts.length >= 2) moduleRoots.add(parts.slice(0, 2).join(path.sep));
  }

  const shapeScores = {
    repoShape: Math.round((scoreDimension(metrics.productFiles, [5, 12, 30, 80, 250]) + scoreDimension(metrics.packageCount + metrics.appCount, [2, 4, 8, 16, 40])) / 2),
    codeVolume: scoreDimension(metrics.productSourceLines, [400, 1500, 12000, 40000, 750000]),
    testBreadth: Math.round((scoreDimension(metrics.testFiles, [2, 5, 10, 20, 80]) + scoreDimension(metrics.testSourceLines, [100, 400, 1200, 3000, 120000])) / 2),
    architectureSplit: scoreDimension([
      metrics.separation.hasApps,
      metrics.separation.hasPackages,
      metrics.separation.hasTests,
      metrics.separation.hasDocs,
      metrics.separation.hasArtifacts,
      metrics.separation.hasRoutesDir,
      metrics.separation.hasDomainFiles
    ].filter(Boolean).length, [3, 5, 6, 7])
  };

  return {
    ok: true,
    repoRoot,
    scannedFiles: files.length,
    metrics: {
      ...metrics,
      moduleRoots: moduleRoots.size,
      productDirs: [...metrics.productDirs].sort()
    },
    shapeScores,
    claims: {
      production_slice: evaluateClaimBudget({ ...metrics, moduleRoots: moduleRoots.size }, 'production_slice', config.claimThresholds),
      scoped_parity: evaluateClaimBudget({ ...metrics, moduleRoots: moduleRoots.size }, 'scoped_parity', config.claimThresholds),
      full_clone_credible: evaluateClaimBudget({ ...metrics, moduleRoots: moduleRoots.size }, 'full_clone_credible', config.claimThresholds),
      large_product_replica: evaluateClaimBudget({ ...metrics, moduleRoots: moduleRoots.size }, 'large_product_replica', config.claimThresholds),
      real_world_indistinguishable: evaluateClaimBudget({ ...metrics, moduleRoots: moduleRoots.size }, 'real_world_indistinguishable', config.claimThresholds)
    },
    generatedAt: new Date().toISOString()
  };
}

export function enforceArchitecture(repoRoot, overrides = {}) {
  const config = {
    ...DEFAULTS,
    ...overrides,
    enforceMaxSourceLines: overrides.enforceMaxSourceLines ?? (Object.prototype.hasOwnProperty.call(overrides, 'maxSourceLines') ? true : DEFAULTS.enforceMaxSourceLines),
    sourceExtensions: overrides.sourceExtensions || DEFAULTS.sourceExtensions,
    claimThresholds: { ...DEFAULTS.claimThresholds, ...(overrides.claimThresholds || {}) }
  };
  const violations = [];
  for (const dir of config.requiredTopLevelDirs) {
    if (!fs.existsSync(path.join(repoRoot, dir))) {
      violations.push({ rule: 'required-top-level-dir', path: dir, message: `Missing ${dir}/` });
    }
  }

  const files = sourceFiles(repoRoot, config);
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/).length;
    if (config.enforceMaxSourceLines && (rel.startsWith('packages/') || rel.startsWith('apps/')) && lines > config.maxSourceLines) {
      violations.push({ rule: 'anti-collapse-max-lines', path: rel, message: `File exceeds ${config.maxSourceLines} lines` });
    }
    if (rel.startsWith('packages/')) {
      const [, pkgName] = rel.split(path.sep);
      const importMatches = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const spec of importMatches) {
        if (!spec.startsWith('../')) continue;
        const normalized = path.normalize(path.join(path.dirname(rel), spec));
        const packageRoot = `packages${path.sep}${pkgName}${path.sep}`;
        if (normalized.startsWith(`packages${path.sep}`) && !normalized.startsWith(packageRoot) && !normalized.endsWith(`${path.sep}index.mjs`)) {
          violations.push({ rule: 'package-boundary', path: rel, message: `Cross-package internal import is forbidden: ${spec}` });
        }
      }
    }
  }

  const budget = evaluateArchitectureBudget(repoRoot, config);
  const honesty = evaluateSurfaceHonesty(repoRoot, config);
  violations.push(...honesty.violations);
  const claimProfile = config.claimProfile || null;
  const claimProfileOk = claimProfile ? budget.claims[claimProfile]?.eligible === true : null;
  if (claimProfile && config.strictClaimProfile && claimProfileOk === false) {
    violations.push({
      rule: 'claim-budget',
      path: repoRoot,
      message: `${claimProfile} budget failed: ${budget.claims[claimProfile].reasons.join(', ')}`
    });
  }

  return {
    ok: violations.length === 0,
    repoRoot,
    scannedFiles: files.length,
    violations,
    budget,
    honesty,
    claimProfile,
    claimProfileOk,
    generatedAt: new Date().toISOString()
  };
}
