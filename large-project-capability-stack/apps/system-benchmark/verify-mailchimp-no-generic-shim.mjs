#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file') args.file = argv[++index];
    else if (token === '--max-generic-line-ratio') args.maxGenericLineRatio = Number(argv[++index]);
    else args._.push(token);
  }
  return args;
}

function genericSemanticShimAudit(source = '') {
  const lines = String(source || '').split('\n');
  const count = (pattern) => (String(source || '').match(pattern) || []).length;
  const patternCounts = {
    semanticProductArchitectureRuntime: count(/semanticProductArchitectureRuntime_/g),
    semanticProductArchitectureFixtureState: count(/semanticProductArchitectureFixtureState_/g),
    semanticProductArchitectureFixtureRouter: count(/semanticProductArchitectureFixtureRouter_/g),
    semanticProductArchitectureExistingProductArgs: count(/semanticProductArchitectureExistingProductArgs_/g),
    semanticProductArchitectureIntegratedCall: count(/semanticProductArchitectureIntegratedCall_/g),
    semanticProductArchitectureNormalFlow: count(/semanticProductArchitectureNormalFlow_/g),
    normalFlowProofGlobal: count(/__semanticProductArchitectureNormalFlowProofs/g),
    inMemorySemanticBenchmark: count(/in_memory_semantic_benchmark/g),
    benchmarkFixtureText: count(/Semantic benchmark workspace|Benchmark Audience|Benchmark Campaign|Benchmark Site|semantic_runtime_verifier/g)
  };
  const genericLines = lines.filter((line) => /semanticProductArchitecture(?:Runtime|FixtureState|FixtureRouter|ExistingProductArgs|IntegratedCall|NormalFlow)_|__semanticProductArchitectureNormalFlowProofs|in_memory_semantic_benchmark|Semantic benchmark workspace|Benchmark Audience|Benchmark Campaign|Benchmark Site|semantic_runtime_verifier/.test(line));
  const genericLineRatio = lines.length > 0 ? Number((genericLines.length / lines.length).toFixed(4)) : 0;
  const generatedRuntimeShimPresent = patternCounts.semanticProductArchitectureRuntime > 0
    && patternCounts.semanticProductArchitectureIntegratedCall > 0
    && patternCounts.semanticProductArchitectureNormalFlow > 0;
  const generatedFixturePresent = patternCounts.semanticProductArchitectureFixtureState > 0
    || patternCounts.semanticProductArchitectureFixtureRouter > 0
    || patternCounts.inMemorySemanticBenchmark > 0
    || patternCounts.benchmarkFixtureText > 0;
  const genericShimSuspect = generatedRuntimeShimPresent && generatedFixturePresent && genericLines.length >= 8;
  return {
    lineCount: lines.length,
    genericLineCount: genericLines.length,
    genericLineRatio,
    patternCounts,
    generatedRuntimeShimPresent,
    generatedFixturePresent,
    genericShimSuspect,
    sampleGenericLines: genericLines.slice(0, 12)
  };
}

const startedAt = Date.now();
const args = parseArgs(process.argv.slice(2));
const surfaceId = args._[0] || null;
const relFile = args.file;
const maxGenericLineRatio = Number.isFinite(args.maxGenericLineRatio) ? args.maxGenericLineRatio : 0;
if (!relFile || path.isAbsolute(relFile) || relFile.includes('..')) {
  console.log(JSON.stringify({ ok: false, surfaceId, file: relFile || null, error: 'missing_or_unsafe_file', durationMs: Date.now() - startedAt }, null, 2));
  process.exit(2);
}
const fullPath = path.resolve(process.cwd(), relFile);
if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
  console.log(JSON.stringify({ ok: false, surfaceId, file: relFile, error: 'file_missing', durationMs: Date.now() - startedAt }, null, 2));
  process.exit(2);
}
const audit = genericSemanticShimAudit(fs.readFileSync(fullPath, 'utf8'));
const ok = !audit.genericShimSuspect && audit.genericLineRatio <= maxGenericLineRatio;
console.log(JSON.stringify({
  ok,
  surfaceId,
  file: relFile,
  verifier: 'mailchimp_no_generic_semantic_shim',
  reason: ok ? 'no_generic_semantic_shim_detected' : 'generic_semantic_shim_detected',
  maxGenericLineRatio,
  audit,
  durationMs: Date.now() - startedAt,
  firstMeaningfulProgressMs: Date.now() - startedAt
}, null, 2));
process.exit(ok ? 0 : 1);
