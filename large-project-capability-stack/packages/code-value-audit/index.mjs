import fs from 'node:fs';
import path from 'node:path';

const CODE_ROOTS = ['apps', 'packages', 'src', 'scripts', 'tests'];
const NON_VALUE_AUDIT_FILES = new Set([
  'scripts/generate-loc-500k-expansion.mjs'
]);
const CORE_TEST_NAMES = new Set([
  'platform-spine.test.mjs',
  'audience-core.test.mjs',
  'campaign-pipeline.test.mjs',
  'automation-journeys.test.mjs',
  'forms-landing.test.mjs',
  'reports-admin.test.mjs',
  'browser-realism.test.mjs',
  'integrations-marketplace.test.mjs',
  'commerce-revenue.test.mjs',
  'deliverability-compliance.test.mjs',
  'collaboration-approval.test.mjs',
  'content-asset-templates.test.mjs'
]);

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function countLines(file) {
  return readText(file).split(/\r?\n/).length;
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function rel(repoRoot, file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, '/');
}

function buildGeneratedPackageSet(files) {
  const out = new Set();
  for (const file of files) {
    const r = rel(path.dirname(path.dirname(path.dirname(file))), file);
    void r;
  }
  return out;
}

function detectGeneratedPackageNames(generatorText) {
  const names = new Set();
  const patterns = [
    /packages\/([a-z0-9-]+)\//g,
    /name:\s*['"]([a-z0-9-]+)['"]/g,
    /slug:\s*['"]([a-z0-9-]+)['"]/g,
    /['"]([a-z0-9-]+)['"]/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(generatorText))) {
      const value = String(match[1] || '').trim();
      if (!value) continue;
      if (value === 'app' || value === 'web' || value === 'scripts' || value === 'tests') continue;
      if (/^[a-z0-9-]+$/.test(value) && value.includes('-')) names.add(value);
    }
  }
  return names;
}

function classifyFile(repoRoot, relativePath, generatedPackageNames) {
  if (relativePath === 'src/server.js') return 'deep_product_parity_code';
  if (relativePath.startsWith('packages/app/')) return 'deep_product_parity_code';
  if (relativePath.startsWith('apps/web/')) return 'deep_product_parity_code';
  if (relativePath.startsWith('scripts/')) return 'support_runtime_evidence_code';

  if (relativePath.startsWith('apps/')) {
    return relativePath.startsWith('apps/web/')
      ? 'deep_product_parity_code'
      : 'mass_generated_or_shallow_expansion';
  }

  if (relativePath.startsWith('packages/')) {
    const parts = relativePath.split('/');
    const pkg = parts[1] || '';
    if (pkg === 'app') return 'deep_product_parity_code';
    if (generatedPackageNames.has(pkg) || pkg === 'scale-wave-seven') return 'mass_generated_or_shallow_expansion';
    return 'mass_generated_or_shallow_expansion';
  }

  if (relativePath.startsWith('tests/')) {
    const base = path.basename(relativePath);
    if (CORE_TEST_NAMES.has(base)) return 'deep_product_parity_code';
    if (base.includes('expansion-showcase') || base.includes('scale-wave')) return 'mass_generated_or_shallow_expansion';
    for (const pkg of generatedPackageNames) {
      if (base.startsWith(`${pkg}.`) || base.startsWith(`${pkg}-`) || base.includes(pkg)) {
        return 'mass_generated_or_shallow_expansion';
      }
    }
    return 'deep_product_parity_code';
  }

  return 'support_runtime_evidence_code';
}

export function buildCodeValueAudit({ repoRoot }) {
  const absoluteRoot = path.resolve(repoRoot);
  const files = [];
  for (const folder of CODE_ROOTS) {
    files.push(...walk(path.join(absoluteRoot, folder)));
  }
  const generatorPath = path.join(absoluteRoot, 'scripts', 'generate-loc-500k-expansion.mjs');
  const generatorText = fs.existsSync(generatorPath) ? readText(generatorPath) : '';
  const generatedPackageNames = detectGeneratedPackageNames(generatorText);

  const buckets = {
    deep_product_parity_code: { lines: 0, files: 0, sample: [] },
    support_runtime_evidence_code: { lines: 0, files: 0, sample: [] },
    mass_generated_or_shallow_expansion: { lines: 0, files: 0, sample: [] }
  };
  const fileRows = [];
  let totalLines = 0;

  for (const file of files) {
    const relativePath = rel(absoluteRoot, file);
    if (NON_VALUE_AUDIT_FILES.has(relativePath)) continue;
    const lineCount = countLines(file);
    const bucket = classifyFile(absoluteRoot, relativePath, generatedPackageNames);
    totalLines += lineCount;
    buckets[bucket].lines += lineCount;
    buckets[bucket].files += 1;
    if (buckets[bucket].sample.length < 20) buckets[bucket].sample.push(relativePath);
    fileRows.push({ path: relativePath, lines: lineCount, bucket });
  }

  const percentages = Object.fromEntries(
    Object.entries(buckets).map(([key, value]) => [key, totalLines ? Number(((value.lines / totalLines) * 100).toFixed(1)) : 0])
  );

  const topFilesByBucket = Object.fromEntries(
    Object.keys(buckets).map((bucket) => [
      bucket,
      fileRows
        .filter((row) => row.bucket === bucket)
        .sort((a, b) => b.lines - a.lines)
        .slice(0, 20)
    ])
  );

  return {
    schemaVersion: 'claw.code-value-audit.v1',
    repoRoot: absoluteRoot,
    generatedAt: new Date().toISOString(),
    heuristic: {
      kind: 'path_and_generator_based',
      note: 'This is a heuristic code-value audit. It is intended to estimate how much repo mass is deep parity code vs support/runtime vs breadth/shallow expansion, not to serve as perfect semantic truth.',
      generatedPackageCount: generatedPackageNames.size,
      coreTestNames: Array.from(CORE_TEST_NAMES)
    },
    totals: {
      codeTestScriptLines: totalLines,
      files: fileRows.length
    },
    buckets,
    percentages,
    topFilesByBucket,
    fileRows
  };
}

export function renderCodeValueReport(audit) {
  const lines = [
    '# Code Value Audit',
    '',
    `- Repo: ${audit.repoRoot}`,
    `- Generated at: ${audit.generatedAt}`,
    `- Total code/test/script lines: ${audit.totals.codeTestScriptLines}`,
    '',
    '## Bucket summary',
    `- Deep product-parity code: ${audit.buckets.deep_product_parity_code.lines} lines (${audit.percentages.deep_product_parity_code}%)`,
    `- Support/runtime/evidence code: ${audit.buckets.support_runtime_evidence_code.lines} lines (${audit.percentages.support_runtime_evidence_code}%)`,
    `- Mass-generated / shallow expansion: ${audit.buckets.mass_generated_or_shallow_expansion.lines} lines (${audit.percentages.mass_generated_or_shallow_expansion}%)`,
    '',
    '## Heuristic note',
    `- ${audit.heuristic.note}`,
    '',
    '## Examples',
    '- Deep product-parity code:',
    ...audit.buckets.deep_product_parity_code.sample.slice(0, 10).map((item) => `  - ${item}`),
    '- Support/runtime/evidence code:',
    ...audit.buckets.support_runtime_evidence_code.sample.slice(0, 10).map((item) => `  - ${item}`),
    '- Mass-generated / shallow expansion:',
    ...audit.buckets.mass_generated_or_shallow_expansion.sample.slice(0, 10).map((item) => `  - ${item}`)
  ];
  return `${lines.join('\n')}\n`;
}
