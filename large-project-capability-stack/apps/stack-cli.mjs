import fs from 'node:fs';
import path from 'node:path';
import { compileTaskContract, loadContract, saveContract } from '../packages/task-contract/index.mjs';
import { loadGraph, readyIssues, summarizeGraph } from '../packages/issue-dag/index.mjs';
import { enforceArchitecture } from '../packages/architecture-enforcer/index.mjs';
import { certifyClaim, saveCertification } from '../packages/certification/index.mjs';
import { compileSurfaceMatrix } from '../packages/surface-matrix/index.mjs';
import { compileClaimIntegrityReport } from '../packages/claim-integrity/index.mjs';

const [, , domain, action, ...rest] = process.argv;

function usage() {
  console.error('Usage:');
  console.error('  node apps/stack-cli.mjs contract compile <spec.json> <out.json>');
  console.error('  node apps/stack-cli.mjs issue-dag ready <graph.json>');
  console.error('  node apps/stack-cli.mjs issue-dag summary <graph.json>');
  console.error('  node apps/stack-cli.mjs architecture check <repoRoot>');
  console.error('  node apps/stack-cli.mjs certification certify <repoRoot> <requestedClaim> <out.json>');
  console.error('  node apps/stack-cli.mjs surface-matrix compile <contract.json> <graph.json> <out.json>');
  console.error('  node apps/stack-cli.mjs claim-integrity compile <spec.json> <out.json>');
  process.exit(1);
}

if (!domain || !action) usage();

if (domain === 'contract' && action === 'compile') {
  const [specPath, outPath] = rest;
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const contract = compileTaskContract(spec);
  saveContract(outPath, contract);
  console.log(JSON.stringify(contract, null, 2));
  process.exit(0);
}

if (domain === 'issue-dag' && action === 'ready') {
  const [graphPath] = rest;
  console.log(JSON.stringify(readyIssues(loadGraph(graphPath)), null, 2));
  process.exit(0);
}

if (domain === 'issue-dag' && action === 'summary') {
  const [graphPath] = rest;
  console.log(JSON.stringify(summarizeGraph(loadGraph(graphPath)), null, 2));
  process.exit(0);
}

if (domain === 'architecture' && action === 'check') {
  const [repoRoot = '.'] = rest;
  const report = enforceArchitecture(path.resolve(repoRoot));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (domain === 'certification' && action === 'certify') {
  const [repoRoot = '.', requestedClaim = 'real_world_indistinguishable', outPath] = rest;
  const certification = certifyClaim({ repoRoot: path.resolve(repoRoot), requestedClaim });
  if (outPath) saveCertification(outPath, certification);
  console.log(JSON.stringify(certification, null, 2));
  process.exit(0);
}

if (domain === 'surface-matrix' && action === 'compile') {
  const [contractPath, graphPath, outPath] = rest;
  const contract = loadContract(contractPath);
  const graph = loadGraph(graphPath);
  const matrix = compileSurfaceMatrix({ contract, graph });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(matrix, null, 2));
  console.log(JSON.stringify(matrix, null, 2));
  process.exit(0);
}

if (domain === 'claim-integrity' && action === 'compile') {
  const [specPath, outPath] = rest;
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const report = compileClaimIntegrityReport(spec);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

usage();
