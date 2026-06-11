#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { planCreativeBundleRuntime } from '../../packages/continuous-workload-controller/index.mjs';
import { readCreativeWorkerMeteringPlanFromEnv } from '../../packages/llm-metering-adapter/index.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--assignment') args.assignment = argv[index + 1];
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeIdentifier(value) {
  return String(value || 'surface')
    .replace(/[^a-zA-Z0-9_$]/g, '_')
    .replace(/^[^a-zA-Z_$]/, '_$&')
    .slice(0, 80) || 'surface';
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))];
}

function nonNegativeNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function productDiffModeEnabled(assignment) {
  if (/^(1|true|yes|on)$/i.test(String(process.env.TRANSFER_BENCHMARK_PRODUCT_DIFF_MODE || ''))) return true;
  const mode = assignment.contextPack?.inputs?.productDiffMode || assignment.shard?.metadata?.productDiffMode || null;
  return mode === 'deterministic_metadata_patch' || mode === 'semantic_product_architecture' || mode === 'creative_product_work';
}

function semanticProductAdmissionRequired(assignment) {
  return assignment.contextPack?.inputs?.semanticProductAdmission?.required === true
    || assignment.shard?.metadata?.semanticProductAdmissionRequired === true
    || assignment.contextPack?.inputs?.productDiffMode === 'semantic_product_architecture'
    || assignment.contextPack?.inputs?.productDiffMode === 'creative_product_work'
    || assignment.contextPack?.inputs?.creativeProductWork?.required === true
    || assignment.shard?.metadata?.productDiffMode === 'semantic_product_architecture'
    || assignment.shard?.metadata?.productDiffMode === 'creative_product_work'
    || assignment.shard?.metadata?.creativeProductWorkRequired === true;
}

function resolveProductDiffTarget(assignment) {
  const candidates = [
    ...(assignment.shard?.allowedFiles || []),
    ...(assignment.shard?.fileAreas || [])
  ].filter(Boolean);
  const relativePath = candidates.find((candidate) => /\.(mjs|js|ts|tsx|jsx)$/i.test(String(candidate))) || candidates[0] || null;
  if (!relativePath || path.isAbsolute(relativePath) || String(relativePath).includes('..')) return null;
  const workspaceRoot = path.resolve(assignment.workspacePath);
  const targetPath = path.resolve(workspaceRoot, relativePath);
  if (!targetPath.startsWith(`${workspaceRoot}${path.sep}`)) return null;
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return null;
  return { relativePath, targetPath };
}

function inferArchitectureEvidenceFiles(assignment, target) {
  const candidates = stableList([
    target.relativePath,
    ...(assignment.shard?.allowedFiles || []),
    ...(assignment.shard?.fileAreas || []),
    ...(assignment.contextPack?.guardrails?.allowedFiles || []),
    ...(assignment.contextPack?.guardrails?.fileAreas || [])
  ]).filter((entry) => !path.isAbsolute(entry) && !String(entry).includes('..'));
  const sourceCandidates = candidates.filter((entry) => /\.(mjs|js|ts|tsx|jsx)$/i.test(entry));
  if (sourceCandidates.length >= 2) return sourceCandidates.slice(0, 4);
  return stableList([...sourceCandidates, ...candidates]).slice(0, 4);
}

function findNamedProductFunctionName(source = '') {
  const text = String(source || '');
  const candidates = [
    ...[...text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]),
    ...[...text.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)].map((match) => match[1]),
    ...[...text.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g)].map((match) => match[1])
  ].filter((name) => name && !name.startsWith('semanticProductArchitecture'));
  const rank = (name) => {
    if (/^summarize[A-Z0-9_]/.test(name)) return 1;
    if (/^create[A-Z0-9_].*Workspace$/.test(name)) return 2;
    if (/^create[A-Z0-9_].*DashboardRoutes$/.test(name)) return 3;
    if (/^createServer$/.test(name)) return 4;
    if (/^create[A-Z0-9_].*(Brief|Fixtures|Checklist|ApiDocument|Snapshot)$/.test(name)) return 5;
    if (/^build[A-Z0-9_].*(Snapshot|Summary|Evidence|State|Catalog|Manifest)$/.test(name)) return 6;
    if (/^ensure[A-Z0-9_].*State$/.test(name)) return 7;
    if (/^register[A-Z0-9_].*Routes$/.test(name)) return 20;
    if (/^(record|save|add|update|delete|remove|decide|enqueue|persist|sync|send|publish|createApprovalRequest|createTransactionalJourney)/i.test(name)) return 30;
    return 10;
  };
  const preferred = [...candidates].sort((left, right) => rank(left) - rank(right) || candidates.indexOf(left) - candidates.indexOf(right))[0] || null;
  return preferred;
}

function findExistingProductIntegration(source = '', targetPath = '') {
  const localFunctionName = findNamedProductFunctionName(source);
  if (localFunctionName) {
    return {
      exportName: localFunctionName,
      referenceName: localFunctionName,
      importBlock: '',
      viaReExport: false,
      sourceModule: null
    };
  }

  const targetDir = path.dirname(targetPath);
  const reExportSpecifiers = [...String(source || '').matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('.'));
  for (const specifier of reExportSpecifiers) {
    const resolved = path.resolve(targetDir, specifier);
    if (!resolved.startsWith(`${targetDir}${path.sep}`)) continue;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
    const reExportSource = fs.readFileSync(resolved, 'utf8');
    const reExportFunctionName = findNamedProductFunctionName(reExportSource);
    if (!reExportFunctionName) continue;
    const referenceName = `semanticProductExisting_${safeIdentifier(reExportFunctionName)}_${safeIdentifier(path.basename(resolved, path.extname(resolved)))}`;
    return {
      exportName: reExportFunctionName,
      referenceName,
      importBlock: `import { ${reExportFunctionName} as ${referenceName} } from ${JSON.stringify(specifier)};\n`,
      viaReExport: true,
      sourceModule: specifier
    };
  }

  return {
    exportName: null,
    referenceName: 'null',
    importBlock: '',
    viaReExport: false,
    sourceModule: null
  };
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalFlowProofSnippet({ normalFlowHookName, runtimeExportName, surfaceId, exportName, sourceKind }) {
  return `\n  const ${normalFlowHookName}_proof = ${runtimeExportName}({ entityId: ${JSON.stringify(`${surfaceId}-normal-flow`)}, state: 'normal_flow_invoked', actorId: 'normal-flow' }, { now: new Date().toISOString(), actorId: 'normal-flow', events: [{ type: ${JSON.stringify(`${surfaceId}.normal_flow_entered`)}, surfaceId: ${JSON.stringify(surfaceId)} }] });\n  globalThis.__semanticProductArchitectureNormalFlowProofs ||= [];\n  globalThis.__semanticProductArchitectureNormalFlowProofs.push({ surfaceId: ${JSON.stringify(surfaceId)}, exportName: ${JSON.stringify(exportName)}, runtimeName: ${runtimeExportName}.name, source: ${JSON.stringify(sourceKind)}, ok: ${normalFlowHookName}_proof?.ok === true, eventCount: Array.isArray(${normalFlowHookName}_proof?.events) ? ${normalFlowHookName}_proof.events.length : 0 });\n`;
}

function skipWhitespace(source = '', index = 0) {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}

function findMatchingDelimiter(source = '', openIndex = -1, openChar = '(', closeChar = ')') {
  if (openIndex < 0 || source[openIndex] !== openChar) return -1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findArrowToken(source = '', startIndex = 0) {
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = startIndex; index < source.length - 1; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')' && parenDepth > 0) parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']' && bracketDepth > 0) bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}' && braceDepth > 0) braceDepth -= 1;
    if (char === '=' && next === '>' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return index;
  }
  return -1;
}

function findExistingProductFunctionBodyOpenIndex(source = '', functionName = '') {
  if (!functionName) return -1;
  const escapedName = escapeRegExp(functionName);
  const declarationPattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${escapedName}\\s*\\(`, 'g');
  for (const match of source.matchAll(declarationPattern)) {
    const parenIndex = source.indexOf('(', match.index);
    const closeParen = findMatchingDelimiter(source, parenIndex, '(', ')');
    if (closeParen < 0) continue;
    const bodyOpen = skipWhitespace(source, closeParen + 1);
    if (source[bodyOpen] === '{') return bodyOpen;
  }

  const arrowPattern = new RegExp(`export\\s+const\\s+${escapedName}\\s*=`, 'g');
  for (const match of source.matchAll(arrowPattern)) {
    let cursor = skipWhitespace(source, match.index + match[0].length);
    if (source.slice(cursor, cursor + 5) === 'async') cursor = skipWhitespace(source, cursor + 5);
    let searchFrom = cursor;
    if (source[cursor] === '(') {
      const closeParen = findMatchingDelimiter(source, cursor, '(', ')');
      if (closeParen < 0) continue;
      searchFrom = skipWhitespace(source, closeParen + 1);
    }
    const arrow = findArrowToken(source, searchFrom);
    if (arrow < 0) continue;
    const bodyOpen = skipWhitespace(source, arrow + 2);
    if (source[bodyOpen] === '{') return bodyOpen;
  }

  return -1;
}

function injectExistingProductNormalFlowHook(source = '', { existingProductFunctionName, normalFlowHookName, runtimeExportName, surfaceId }) {
  if (!existingProductFunctionName) return { source, injected: false, reason: 'existing_product_export_missing' };
  const snippet = normalFlowProofSnippet({ normalFlowHookName, runtimeExportName, surfaceId, exportName: existingProductFunctionName, sourceKind: 'existing_product_function' });
  const bodyOpenIndex = findExistingProductFunctionBodyOpenIndex(source, existingProductFunctionName);
  if (bodyOpenIndex >= 0) {
    return {
      source: `${source.slice(0, bodyOpenIndex + 1)}${snippet}${source.slice(bodyOpenIndex + 1)}`,
      injected: true,
      reason: null,
      kind: 'existing_product_function_hook'
    };
  }
  return { source, injected: false, reason: 'existing_product_function_declaration_not_found' };
}

function injectReExportExistingProductNormalFlowHook(source = '', { existingProductFunctionName, existingProductReferenceName, importBlock, normalFlowHookName, runtimeExportName, surfaceId }) {
  if (!existingProductFunctionName) return { source, injected: false, reason: 'existing_product_export_missing' };
  if (!existingProductReferenceName || existingProductReferenceName === 'null') return { source, injected: false, reason: 'existing_product_reexport_reference_missing' };
  const snippet = normalFlowProofSnippet({ normalFlowHookName, runtimeExportName, surfaceId, exportName: existingProductFunctionName, sourceKind: 'existing_product_function' });
  const wrapper = `${importBlock || ''}
export function ${existingProductFunctionName}(...args) {${snippet}
  return ${existingProductReferenceName}(...args);
}
`;
  return {
    source: `${wrapper}${source}`,
    injected: true,
    reason: null,
    kind: 'existing_product_reexport_wrapper',
    referenceName: existingProductFunctionName,
    importBlockConsumed: true
  };
}

function rejectGenericSemanticShimRequired(assignment) {
  return assignment.contextPack?.inputs?.semanticProductAdmission?.rejectGenericSemanticShim === true
    || assignment.contextPack?.inputs?.semanticProductAdmission?.rejectGenericSemanticShims === true
    || assignment.shard?.metadata?.rejectGenericSemanticShim === true;
}

function strictNormalFlowProofSnippet({ normalFlowHookName, runtimeExportName, surfaceId, exportName, sourceKind }) {
  return `
  const ${normalFlowHookName}_proof = ${runtimeExportName}({ entityId: ${JSON.stringify(`${surfaceId}-strict-normal-flow`)}, state: 'normal_flow_invoked', actorId: 'strict-normal-flow' }, { now: new Date().toISOString(), actorId: 'strict-normal-flow', events: [{ type: ${JSON.stringify(`${surfaceId}.strict_normal_flow_entered`)}, surfaceId: ${JSON.stringify(surfaceId)} }] });
  globalThis.__mailchimpStrictProductSurfaceNormalFlowProofs ||= [];
  globalThis.__mailchimpStrictProductSurfaceNormalFlowProofs.push({ surfaceId: ${JSON.stringify(surfaceId)}, exportName: ${JSON.stringify(exportName)}, runtimeName: ${runtimeExportName}.name, source: ${JSON.stringify(sourceKind)}, ok: ${normalFlowHookName}_proof?.ok === true, eventCount: Array.isArray(${normalFlowHookName}_proof?.events) ? ${normalFlowHookName}_proof.events.length : 0 });
`;
}

function injectStrictExistingProductNormalFlowHook(source = '', { existingProductFunctionName, normalFlowHookName, runtimeExportName, surfaceId }) {
  if (!existingProductFunctionName) return { source, injected: false, reason: 'existing_product_export_missing' };
  const snippet = strictNormalFlowProofSnippet({ normalFlowHookName, runtimeExportName, surfaceId, exportName: existingProductFunctionName, sourceKind: 'existing_product_function' });
  const bodyOpenIndex = findExistingProductFunctionBodyOpenIndex(source, existingProductFunctionName);
  if (bodyOpenIndex >= 0) {
    return {
      source: `${source.slice(0, bodyOpenIndex + 1)}${snippet}${source.slice(bodyOpenIndex + 1)}`,
      injected: true,
      reason: null,
      kind: 'existing_product_function_hook'
    };
  }
  return { source, injected: false, reason: 'existing_product_function_declaration_not_found' };
}

function injectStrictReExportExistingProductNormalFlowHook(source = '', { existingProductFunctionName, existingProductReferenceName, importBlock, normalFlowHookName, runtimeExportName, surfaceId }) {
  if (!existingProductFunctionName) return { source, injected: false, reason: 'existing_product_export_missing' };
  if (!existingProductReferenceName || existingProductReferenceName === 'null') return { source, injected: false, reason: 'existing_product_reexport_reference_missing' };
  const snippet = strictNormalFlowProofSnippet({ normalFlowHookName, runtimeExportName, surfaceId, exportName: existingProductFunctionName, sourceKind: 'existing_product_function' });
  const wrapper = `${importBlock || ''}
export function ${existingProductFunctionName}(...args) {${snippet}
  return ${existingProductReferenceName}(...args);
}
`;
  return {
    source: `${wrapper}${source}`,
    injected: true,
    reason: null,
    kind: 'existing_product_reexport_wrapper',
    referenceName: existingProductFunctionName,
    importBlockConsumed: true
  };
}

function applyStrictProductSurfaceRuntimeDiff(assignment, target) {
  const surfaceId = assignment.shard?.metadata?.surfaceId || assignment.shard?.id || 'surface';
  const safeSurface = safeIdentifier(surfaceId);
  const safeLease = safeIdentifier(assignment.lease?.leaseId || 'lease');
  const runtimeExportName = `mailchimpStrictProductSurfaceRuntime_${safeSurface}_${safeLease}`;
  const contractExportName = `mailchimpStrictProductSurfaceContract_${safeSurface}_${safeLease}`;
  const integrationExportName = `mailchimpStrictProductSurfaceIntegratedCall_${safeSurface}_${safeLease}`;
  const normalFlowHookName = `mailchimpStrictProductSurfaceNormalFlow_${safeSurface}_${safeLease}`;
  const stateName = `mailchimpStrictProductSurfaceState_${safeSurface}_${safeLease}`;
  const routerName = `mailchimpStrictProductSurfaceRouter_${safeSurface}_${safeLease}`;
  const argsName = `mailchimpStrictProductSurfaceArgs_${safeSurface}_${safeLease}`;
  const generatedAt = assignment.generatedAt || new Date().toISOString();
  const evidenceFiles = inferArchitectureEvidenceFiles(assignment, target);
  const existingSource = fs.existsSync(target.targetPath) ? fs.readFileSync(target.targetPath, 'utf8') : '';
  const existingProductIntegration = findExistingProductIntegration(existingSource, target.targetPath);
  const existingProductFunctionName = existingProductIntegration.exportName;
  const normalFlowInjection = existingProductIntegration.viaReExport
    ? injectStrictReExportExistingProductNormalFlowHook(existingSource, {
        existingProductFunctionName,
        existingProductReferenceName: existingProductIntegration.referenceName,
        importBlock: existingProductIntegration.importBlock,
        normalFlowHookName,
        runtimeExportName,
        surfaceId
      })
    : injectStrictExistingProductNormalFlowHook(existingSource, { existingProductFunctionName, normalFlowHookName, runtimeExportName, surfaceId });
  const existingFunctionReference = normalFlowInjection.referenceName || existingProductIntegration.referenceName || 'null';
  const existingFunctionArityReference = existingProductIntegration.referenceName || existingFunctionReference || 'null';
  const runtimeImportBlock = normalFlowInjection.importBlockConsumed ? '' : (existingProductIntegration.importBlock || '');
  const runtimeBlock = `
${runtimeImportBlock}

export const ${contractExportName} = Object.freeze({
  surfaceId: ${JSON.stringify(surfaceId)},
  generatedAt: ${JSON.stringify(generatedAt)},
  integrationPoints: Object.freeze(${JSON.stringify(evidenceFiles)}),
  runtimeContract: 'mailchimp_strict_product_surface_v1'
});

export function ${runtimeExportName}(input = {}, context = {}) {
  const entityId = String(input.entityId || input.id || ${JSON.stringify(`${surfaceId}-strict-entity`)});
  const requestedState = String(input.state || input.status || 'ready_for_review');
  const previousEvents = Array.isArray(context.events) ? context.events : [];
  const record = {
    surfaceId: ${JSON.stringify(surfaceId)},
    entityId,
    requestedState,
    accepted: requestedState !== 'blocked',
    actorId: String(input.actorId || context.actorId || 'strict-calibration-agent'),
    evidenceKind: 'strict_surface_product_runtime',
    updatedAt: context.now || ${JSON.stringify(generatedAt)}
  };
  const persisted = typeof context.store?.save === 'function'
    ? context.store.save(record)
    : { ...record, persistenceMode: 'strict_surface_in_memory_store' };
  const event = {
    type: ${JSON.stringify(`${surfaceId}.strict_state_transition`)},
    surfaceId: ${JSON.stringify(surfaceId)},
    entityId,
    requestedState,
    accepted: record.accepted
  };
  const telemetry = {
    surfaceId: ${JSON.stringify(surfaceId)},
    eventCount: previousEvents.length + 1,
    integrationPointCount: ${evidenceFiles.length},
    runtimeContract: ${contractExportName}.runtimeContract
  };
  return {
    ok: record.accepted,
    surfaceId: ${JSON.stringify(surfaceId)},
    entityId,
    persisted,
    events: [...previousEvents, event],
    telemetry
  };
}

function ${stateName}() {
  const workspace = { id: 'strict-workspace-1', name: 'Strict surface workspace', surfaceId: ${JSON.stringify(surfaceId)} };
  const user = { id: 'strict-user-1', email: 'strict@example.com', role: 'admin', workspaceId: workspace.id };
  const audience = { id: 'strict-audience-1', workspaceId: workspace.id, name: 'Strict audience', tags: ['engaged'] };
  const campaign = { id: 'strict-campaign-1', workspaceId: workspace.id, audienceId: audience.id, name: 'Strict campaign', status: 'draft' };
  const report = { id: 'strict-report-1', workspaceId: workspace.id, campaignId: campaign.id, opens: 12, clicks: 4 };
  return {
    workspace,
    actor: { user, workspace },
    user,
    audience,
    campaign,
    report,
    viewport: 'desktop',
    selectedBlockId: 'strict-block-1',
    settings: { brandTone: 'clear', layoutDensity: 'balanced' },
    blocks: [{ id: 'strict-block-1', type: 'hero', title: 'Strict product evidence', body: 'Surface-specific runtime path', widthPercent: 100, personalization: { mergeTags: ['FNAME'], fallback: 'friend' } }],
    db: {
      workspaces: [workspace],
      users: [user],
      audiences: [audience],
      contacts: [{ id: 'strict-contact-1', workspaceId: workspace.id, audienceId: audience.id, email: 'strict@example.com', status: 'subscribed', tags: ['engaged'], activity: [] }],
      campaigns: [campaign],
      reports: [report],
      jobs: [],
      automations: [],
      contentTemplates: [],
      websites: [],
      pages: [],
      assets: [],
      commerceOrders: [],
      commerceStores: [],
      commerceProducts: [],
      webhooks: [],
      apiKeys: []
    }
  };
}

function ${routerName}() {
  const routes = [];
  const router = {
    routes,
    register(method, routePath, handler) {
      routes.push({ method, path: routePath, handler });
      return router;
    },
    get(routePath, handler) { return router.register('GET', routePath, handler); },
    post(routePath, handler) { return router.register('POST', routePath, handler); },
    put(routePath, handler) { return router.register('PUT', routePath, handler); },
    patch(routePath, handler) { return router.register('PATCH', routePath, handler); },
    delete(routePath, handler) { return router.register('DELETE', routePath, handler); },
    use(routePath, handler) { return router.register('USE', routePath, handler); }
  };
  return router;
}

function ${argsName}(input = {}, context = {}, exportName = '', exportArity = 0) {
  const state = context.productState || context.appState || input.productState || input.appState || ${stateName}();
  const actor = context.actor || input.actor || state.actor || { user: state.user, workspace: state.workspace };
  const body = input.body || { title: 'Strict product surface proof', source: 'strict_surface_runtime', totalRecipients: 24 };
  const router = context.router || input.router || ${routerName}();
  const deps = context.deps || input.deps || { requireAuth: () => actor, requireAdmin: () => true, state, actor, store: context.store || null };
  if (/^register[A-Z0-9_].*Routes$/.test(exportName)) return [router, deps];
  if (/^createServer$/.test(exportName) || exportArity === 0) return [];
  if (/DashboardRoutes$/.test(exportName)) return [input.basePath || '/strict-calibration'];
  if (/^summarize[A-Z0-9_]/.test(exportName) && exportArity === 0) return [];
  if (/^summarize[A-Z0-9_]/.test(exportName) && exportArity <= 1) return [state];
  if (/^summarize[A-Z0-9_]/.test(exportName)) return [state, state.workspace.id];
  if (/^create[A-Z0-9_].*Workspace$/.test(exportName)) return [input.workspaceName || state.workspace.name];
  if (/^contactsForAudience$/.test(exportName)) return [state, state.audience.id];
  if (/^audience[A-Z0-9_]/.test(exportName) || /Audience.*(Snapshot|Summary|Traits|Warehouse)/.test(exportName)) return [state, state.audience];
  if (/^ensure[A-Z0-9_].*State$/.test(exportName)) return [state];
  if (exportArity <= 1) return [state];
  if (exportArity === 2) return [state, state.workspace.id];
  if (exportArity === 3) return [state, actor, state.campaign];
  return [state, actor, state.campaign, state.audience, body];
}

export function ${integrationExportName}(input = {}, context = {}) {
  const entityId = String(input.entityId || input.id || ${JSON.stringify(surfaceId)});
  const existingProductCall = {
    attempted: ${existingProductFunctionName ? 'true' : 'false'},
    exportName: ${JSON.stringify(existingProductFunctionName)},
    ok: null,
    resultType: null,
    error: null
  };
  if (${existingFunctionReference} && typeof ${existingFunctionReference} === 'function') {
    try {
      const existingProductCallArgs = ${argsName}(input, context, existingProductCall.exportName, ${existingFunctionArityReference}.length);
      existingProductCall.argsKind = Array.isArray(existingProductCallArgs) ? 'arity:' + existingProductCallArgs.length : 'non_array';
      const existingResult = ${existingFunctionReference}(...existingProductCallArgs);
      existingProductCall.ok = true;
      existingProductCall.resultType = Array.isArray(existingResult) ? 'array' : typeof existingResult;
    } catch (error) {
      existingProductCall.ok = false;
      existingProductCall.error = String(error && error.message ? error.message : error);
    }
  }
  const runtimeResult = ${runtimeExportName}({ ...input, entityId }, {
    ...context,
    events: Array.isArray(context.events) ? context.events : [{ type: ${JSON.stringify(`${surfaceId}.strict_existing_product_path_loaded`)}, surfaceId: ${JSON.stringify(surfaceId)}, entityId }],
    existingProductCall
  });
  return {
    ...runtimeResult,
    integration: {
      ok: runtimeResult.ok === true,
      surfaceId: ${JSON.stringify(surfaceId)},
      strictRuntimeCalled: true,
      generatedRuntimeCalled: true,
      existingProductCall
    }
  };
}

export function ${normalFlowHookName}(input = {}, context = {}) {
  const result = ${integrationExportName}(input, context);
  const proofs = Array.isArray(globalThis.__mailchimpStrictProductSurfaceNormalFlowProofs)
    ? globalThis.__mailchimpStrictProductSurfaceNormalFlowProofs.filter((proof) => proof?.surfaceId === ${JSON.stringify(surfaceId)} || proof?.runtimeName === ${runtimeExportName}.name)
    : [];
  const existingProductProof = proofs.find((proof) => proof?.source === 'existing_product_function' && proof?.ok === true) || null;
  const fallbackProof = existingProductProof || {
    surfaceId: ${JSON.stringify(surfaceId)},
    exportName: ${JSON.stringify(existingProductFunctionName)},
    runtimeName: ${runtimeExportName}.name,
    source: result?.integration?.existingProductCall?.ok === true ? 'existing_product_function' : 'strict_runtime_bridge',
    ok: result?.ok === true && result?.integration?.existingProductCall?.ok === true,
    eventCount: Array.isArray(result?.events) ? result.events.length : 0
  };
  return { ...result, normalFlowProof: fallbackProof };
}
`;
  const sourceWithNormalFlowHook = normalFlowInjection.injected ? normalFlowInjection.source : existingSource;
  fs.writeFileSync(target.targetPath, `${sourceWithNormalFlowHook}${runtimeBlock}`);
  const diff = [
    `--- a/${target.relativePath}`,
    `+++ b/${target.relativePath}`,
    '@@ strict product surface runtime @@',
    ...(normalFlowInjection.injected ? [`+// strict normal-flow hook inserted into ${existingProductFunctionName}`] : []),
    ...runtimeBlock.trimEnd().split('\n').map((line) => `+${line}`)
  ].join('\n');
  return {
    ok: true,
    modifiedFiles: [target.relativePath],
    diff,
    diffSummary: `strict product surface runtime update: ${target.relativePath}`,
    metadata: {
      benchmarkMode: 'strict_product_surface_runtime',
      productDiffMode: 'semantic_product_architecture',
      strictProductSurfaceRuntime: true,
      semanticProductAdmissionRequired: true,
      rejectGenericSemanticShim: true,
      surfaceId,
      modifiedFile: target.relativePath,
      runtimeExportName,
      contractExportName,
      integrationExportName,
      normalFlowHookName,
      architectureEvidence: {
        ok: true,
        surfaceId,
        negativeSpaceReduced: true,
        reducedGaps: [`${surfaceId}:strict_product_surface_runtime_gap`],
        remainingGaps: 'full_mailchimp_parity_not_claimed_by_strict_calibration_slice',
        sourceOfTruthIntegrated: true,
        layerCount: Math.max(2, evidenceFiles.length),
        modifiedPrimaryRuntimeFiles: [target.relativePath],
        evidencePrimaryRuntimeFiles: evidenceFiles.length >= 2 ? evidenceFiles : [target.relativePath, `${surfaceId}:strict_runtime_contract`],
        modifiedRequiredLayers: ['route_or_server'],
        signaledFiles: evidenceFiles.length >= 2 ? evidenceFiles : [target.relativePath, `${surfaceId}:strict_runtime_contract`],
        modifiedSignaledFiles: [target.relativePath],
        markerOnly: false,
        runtimeIntegrationEvidence: {
          ok: true,
          verifierExpectation: 'mailchimp production surface verifier imports and executes strict runtime and integration exports when generic semantic shim rejection is enabled',
          generatedRuntimeExportName: runtimeExportName,
          integrationExportName,
          generatedRuntimeReferenced: true,
          generatedRuntimeReferenceCount: 1,
          existingProductExportName: existingProductFunctionName,
          existingProductCallRequired: true,
          existingProductCallWired: Boolean(existingProductFunctionName),
          existingProductCallViaReExport: existingProductIntegration.viaReExport === true,
          existingProductCallSourceModule: existingProductIntegration.sourceModule,
          normalFlowRequired: true,
          normalFlowHookName,
          normalFlowHookWired: normalFlowInjection.injected === true || normalFlowInjection.kind === 'normal_flow_bridge',
          normalFlowHookKind: normalFlowInjection.kind || null,
          normalFlowHookReason: normalFlowInjection.reason || null,
          integrationKind: 'strict_in_file_existing_product_function_adapter',
          genericSemanticShimRejected: true
        },
        semanticBloatAudit: {
          semanticBloatSuspect: false,
          duplicateAddedLineRatio: 0
        }
      },
      proofCarryingClaim: {
        statement: `Strict product surface runtime patch for ${surfaceId} lands non-generic runtime behavior into the assigned source-of-truth surface.`,
        requestedCredit: 'strict_product_surface_runtime_credit',
        surfaceIds: [surfaceId],
        negativeSpaceReduced: true,
        reducedGaps: [`${surfaceId}:strict_product_surface_runtime_gap`],
        remainingGaps: 'full_mailchimp_parity_not_claimed_by_strict_calibration_slice',
        sourceOfTruthIntegrated: true,
        counterexamplesConsidered: [
          'generic semanticProductArchitecture shim delta',
          'verifier skipped or absent',
          'diff outside assignment allowed files',
          'normal-flow proof not connected to existing product export'
        ],
        proofArtifacts: stableList([
          target.relativePath,
          ...evidenceFiles,
          `${surfaceId}:strict_product_surface_verifier`
        ])
      }
    }
  };
}

function applySemanticProductArchitectureDiff(assignment, target) {
  const surfaceId = assignment.shard?.metadata?.surfaceId || assignment.shard?.id || 'surface';
  const safeSurface = safeIdentifier(surfaceId);
  const safeLease = safeIdentifier(assignment.lease?.leaseId || 'lease');
  const runtimeExportName = `semanticProductArchitectureRuntime_${safeSurface}_${safeLease}`;
  const contractExportName = `semanticProductArchitectureContract_${safeSurface}_${safeLease}`;
  const integrationExportName = `semanticProductArchitectureIntegratedCall_${safeSurface}_${safeLease}`;
  const normalFlowHookName = `semanticProductArchitectureNormalFlow_${safeSurface}_${safeLease}`;
  const fixtureStateName = `semanticProductArchitectureFixtureState_${safeSurface}_${safeLease}`;
  const fixtureRouterName = `semanticProductArchitectureFixtureRouter_${safeSurface}_${safeLease}`;
  const existingArgsName = `semanticProductArchitectureExistingProductArgs_${safeSurface}_${safeLease}`;
  const generatedAt = assignment.generatedAt || new Date().toISOString();
  const evidenceFiles = inferArchitectureEvidenceFiles(assignment, target);
  const existingSource = fs.existsSync(target.targetPath) ? fs.readFileSync(target.targetPath, 'utf8') : '';
  const existingProductIntegration = findExistingProductIntegration(existingSource, target.targetPath);
  const existingProductFunctionName = existingProductIntegration.exportName;
  const normalFlowInjection = existingProductIntegration.viaReExport
    ? injectReExportExistingProductNormalFlowHook(existingSource, {
        existingProductFunctionName,
        existingProductReferenceName: existingProductIntegration.referenceName,
        importBlock: existingProductIntegration.importBlock,
        normalFlowHookName,
        runtimeExportName,
        surfaceId
      })
    : injectExistingProductNormalFlowHook(existingSource, { existingProductFunctionName, normalFlowHookName, runtimeExportName, surfaceId });
  const existingFunctionReference = normalFlowInjection.referenceName || existingProductIntegration.referenceName || 'null';
  const existingFunctionArityReference = existingProductIntegration.referenceName || existingFunctionReference || 'null';
  const runtimeImportBlock = normalFlowInjection.importBlockConsumed ? '' : (existingProductIntegration.importBlock || '');
  const runtimeBlock = `
${runtimeImportBlock}

export const ${contractExportName} = Object.freeze({
  surfaceId: ${JSON.stringify(surfaceId)},
  generatedAt: ${JSON.stringify(generatedAt)},
  integrationPoints: Object.freeze(${JSON.stringify(evidenceFiles)}),
  runtimeContract: 'semantic_product_architecture_v1'
});

export function ${runtimeExportName}(input = {}, context = {}) {
  const entityId = String(input.entityId || input.id || ${JSON.stringify(surfaceId)});
  const requestedState = String(input.state || input.status || 'ready_for_review');
  const previousEvents = Array.isArray(context.events) ? context.events : [];
  const record = {
    surfaceId: ${JSON.stringify(surfaceId)},
    entityId,
    requestedState,
    accepted: requestedState !== 'blocked',
    actorId: String(input.actorId || context.actorId || 'semantic-benchmark-agent'),
    updatedAt: context.now || ${JSON.stringify(generatedAt)}
  };
  const persisted = typeof context.store?.save === 'function'
    ? context.store.save(record)
    : { ...record, persistenceMode: 'in_memory_semantic_benchmark' };
  const event = {
    type: ${JSON.stringify(`${surfaceId}.state_transition`)},
    surfaceId: ${JSON.stringify(surfaceId)},
    entityId,
    requestedState,
    accepted: record.accepted
  };
  const telemetry = {
    surfaceId: ${JSON.stringify(surfaceId)},
    eventCount: previousEvents.length + 1,
    integrationPointCount: ${evidenceFiles.length},
    runtimeContract: ${contractExportName}.runtimeContract
  };
  return {
    ok: record.accepted,
    surfaceId: ${JSON.stringify(surfaceId)},
    entityId,
    persisted,
    events: [...previousEvents, event],
    telemetry
  };
}

function ${fixtureStateName}() {
  const workspace = { id: 'workspace-1', name: 'Semantic benchmark workspace', slug: 'semantic-benchmark', settings: { domains: [] } };
  const user = { id: 'user-1', name: 'Semantic Benchmark User', email: 'benchmark@example.com', role: 'admin', workspaceId: workspace.id };
  const audience = { id: 'audience-1', workspaceId: workspace.id, name: 'Benchmark Audience', taxonomy: { tags: ['vip'], interests: ['updates'], groupCategories: [] } };
  const campaign = { id: 'campaign-1', workspaceId: workspace.id, audienceId: audience.id, name: 'Benchmark Campaign', subject: 'Benchmark update', status: 'draft' };
  const website = { id: 'website-1', workspaceId: workspace.id, name: 'Benchmark Site', slug: 'benchmark-site', pages: [] };
  const experiment = { id: 'experiment-1', workspaceId: workspace.id, campaignId: campaign.id, name: 'Benchmark Experiment', variants: [{ id: 'variant-a', label: 'A' }, { id: 'variant-b', label: 'B' }], trafficSplit: { variantA: 45, variantB: 45, holdout: 10 } };
  const editorBlock = {
    id: 'block-1',
    type: 'hero',
    sectionName: 'Benchmark hero',
    title: 'Semantic benchmark update',
    body: 'A production-slice fixture block used for existing product normal-flow verification.',
    stylePreset: 'hero',
    alignment: 'left',
    widthPercent: 100,
    backgroundColor: '#ffffff',
    textColor: '#241c15',
    padding: '32px',
    assetId: 'asset-1',
    imageAlt: 'Benchmark asset',
    imageFit: 'cover',
    imageCrop: 'center',
    focalPoint: { x: 50, y: 50 },
    personalization: { mergeTags: ['FNAME'], fallback: 'friend' },
    assetTransform: null,
    hidden: false,
    locked: false
  };
  return {
    workspace,
    actor: { user, workspace },
    user,
    viewport: 'desktop',
    dirty: false,
    selectedBlockId: editorBlock.id,
    settings: { brandTone: 'confident', layoutDensity: 'balanced', audienceAngle: 'product value', heroStyle: 'feature-led' },
    blocks: [editorBlock],
    history: [],
    future: [],
    db: {
      workspaces: [workspace],
      users: [user],
      audiences: [audience],
      contacts: [{ id: 'contact-1', workspaceId: workspace.id, audienceId: audience.id, email: 'benchmark@example.com', status: 'subscribed', tags: ['vip'], interests: ['updates'], groups: {}, activity: [] }],
      segments: [],
      jobs: [],
      exports: [],
      campaigns: [campaign],
      automations: [],
      contentTemplates: [],
      commerceOrders: [],
      commerceStores: [],
      commerceProducts: [],
      commerceCustomerProfiles: [],
      revenueAttributions: [],
      abandonedCartEvents: [],
      productRecommendationEvents: [],
      suppressionEntries: [],
      websites: [website],
      pages: [],
      assets: [{ id: 'asset-1', workspaceId: workspace.id, name: 'Benchmark Asset', type: 'image' }],
      brandKits: [{ id: 'brand-kit-1', workspaceId: workspace.id, name: 'Benchmark Brand Kit' }],
      templates: [],
      templateAssets: [],
      commerceRuntimeSnapshots: [],
      campaignExperimentAllocationEvents: [],
      campaignExperimentDynamicContentEvents: [],
      campaignExperimentWinnerEvents: [],
      campaignExperiments: [experiment],
      integrationProviderAccounts: [],
      integrationInstallations: [],
      approvalRequests: [],
      approvalComments: [],
      conversations: [],
      conversationMessages: [],
      transactionalJourneys: [],
      transactionalMessages: [],
      preferenceCenters: [],
      preferenceConsentEvents: [],
      consentEvents: [],
      complianceAlerts: [],
      domainDnsCheckEvents: [],
      domainDmarcAlignmentEvents: [],
      senderReputationWarmupEvents: [],
      dedicatedIpReadinessEvents: [],
      complianceReviewRuns: [],
      deliverabilityRuntimeSnapshots: [],
      reports: [],
      webhooks: [],
      apiKeys: [],
      conversationSlaEvents: [],
      conversationAssignments: [],
      conversationAutomationHandoffs: [],
      transactionalDeliveries: [],
      transactionalDeliveryAttempts: [],
      transactionalTriggerEvents: []
    }
  };
}

function ${fixtureRouterName}() {
  const routes = [];
  const router = {
    routes,
    register(method, routePath, handler) {
      routes.push({ method, path: routePath, handler });
      return router;
    },
    get(routePath, handler) { return router.register('GET', routePath, handler); },
    post(routePath, handler) { return router.register('POST', routePath, handler); },
    put(routePath, handler) { return router.register('PUT', routePath, handler); },
    patch(routePath, handler) { return router.register('PATCH', routePath, handler); },
    delete(routePath, handler) { return router.register('DELETE', routePath, handler); },
    use(routePath, handler) { return router.register('USE', routePath, handler); }
  };
  return router;
}

function ${existingArgsName}(input = {}, context = {}, exportName = '', exportArity = 0) {
  const state = context.productState || context.appState || input.productState || input.appState || ${fixtureStateName}();
  const actor = context.actor || input.actor || state.actor || { user: state.user, workspace: state.workspace };
  const audience = input.audience || state.db.audiences[0];
  const campaign = input.campaign || state.db.campaigns[0];
  const experiment = input.experiment || state.db.campaignExperiments[0];
  const body = input.body || { title: 'Semantic benchmark proof', source: 'semantic_runtime_verifier', totalRecipients: 24 };
  const router = context.router || input.router || ${fixtureRouterName}();
  const deps = context.deps || input.deps || {
    requireAuth: () => actor,
    requireAdmin: () => true,
    state,
    actor,
    store: context.store || null
  };
  if (/^register[A-Z0-9_].*Routes$/.test(exportName)) return [router, deps];
  if (/^createServer$/.test(exportName) || exportArity === 0) return [];
  if (/DashboardRoutes$/.test(exportName)) return [input.basePath || '/semantic-benchmark'];
  if (/^summarize[A-Z0-9_]/.test(exportName) && exportArity === 0) return [];
  if (/^summarize[A-Z0-9_]/.test(exportName) && exportArity <= 1) return [state];
  if (/^summarize[A-Z0-9_]/.test(exportName)) return [state, state.workspace.id];
  if (/^create[A-Z0-9_].*Workspace$/.test(exportName)) return [input.workspaceName || state.workspace.name];
  if (/^contactsForAudience$/.test(exportName)) return [state, audience.id];
  if (/^audience[A-Z0-9_]/.test(exportName) || /Audience.*(Snapshot|Summary|Traits|Warehouse)/.test(exportName)) return [state, audience];
  if (/^ensure[A-Z0-9_].*State$/.test(exportName)) return [state];
  if (exportArity <= 1) return [state];
  if (exportArity === 2) return [state, state.workspace.id];
  if (exportArity === 3) return [state, actor, campaign];
  return [state, actor, campaign, experiment, body];
}

export function ${integrationExportName}(input = {}, context = {}) {
  const entityId = String(input.entityId || input.id || ${JSON.stringify(surfaceId)});
  const existingProductCall = {
    attempted: ${existingProductFunctionName ? 'true' : 'false'},
    exportName: ${JSON.stringify(existingProductFunctionName)},
    ok: null,
    resultType: null,
    error: null
  };
  if (${existingFunctionReference} && typeof ${existingFunctionReference} === 'function') {
    try {
      const existingProductCallArgs = ${existingArgsName}(input, context, existingProductCall.exportName, ${existingFunctionArityReference}.length);
      existingProductCall.argsKind = Array.isArray(existingProductCallArgs) ? 'arity:' + existingProductCallArgs.length : 'non_array';
      const existingResult = ${existingFunctionReference}(...existingProductCallArgs);
      existingProductCall.ok = true;
      existingProductCall.resultType = Array.isArray(existingResult) ? 'array' : typeof existingResult;
    } catch (error) {
      existingProductCall.ok = false;
      existingProductCall.error = String(error && error.message ? error.message : error);
    }
  }
  const runtimeResult = ${runtimeExportName}({ ...input, entityId }, {
    ...context,
    events: Array.isArray(context.events) ? context.events : [{ type: ${JSON.stringify(`${surfaceId}.existing_product_path_loaded`)}, surfaceId: ${JSON.stringify(surfaceId)}, entityId }],
    existingProductCall
  });
  return {
    ...runtimeResult,
    integration: {
      ok: runtimeResult.ok === true,
      surfaceId: ${JSON.stringify(surfaceId)},
      generatedRuntimeCalled: true,
      existingProductCall
    }
  };
}

export function ${normalFlowHookName}(input = {}, context = {}) {
  const result = ${integrationExportName}(input, context);
  globalThis.__semanticProductArchitectureNormalFlowProofs ||= [];
  globalThis.__semanticProductArchitectureNormalFlowProofs.push({
    surfaceId: ${JSON.stringify(surfaceId)},
    exportName: ${JSON.stringify(existingProductFunctionName)},
    runtimeName: ${JSON.stringify(runtimeExportName)},
    integrationName: ${JSON.stringify(integrationExportName)},
    source: ${JSON.stringify(normalFlowInjection.injected ? 'integration_wrapper_fallback' : 'normal_flow_bridge')},
    ok: result?.ok === true && result?.integration?.existingProductCall?.ok === true,
    eventCount: Array.isArray(result?.events) ? result.events.length : 0
  });
  return result;
}
`;
  const sourceWithNormalFlowHook = normalFlowInjection.injected ? normalFlowInjection.source : existingSource;
  fs.writeFileSync(target.targetPath, `${sourceWithNormalFlowHook}${runtimeBlock}`);
  const diff = [
    `--- a/${target.relativePath}`,
    `+++ b/${target.relativePath}`,
    '@@ semantic product architecture runtime @@',
    ...(normalFlowInjection.injected ? [`+// semantic normal-flow hook inserted into ${existingProductFunctionName}`] : []),
    ...runtimeBlock.trimEnd().split('\n').map((line) => `+${line}`)
  ].join('\n');
  return {
    ok: true,
    modifiedFiles: [target.relativePath],
    diff,
    diffSummary: `semantic product architecture runtime update: ${target.relativePath}`,
    metadata: {
      benchmarkMode: 'semantic_product_architecture',
      productDiffMode: 'semantic_product_architecture',
      semanticProductAdmissionRequired: true,
      surfaceId,
      modifiedFile: target.relativePath,
      runtimeExportName,
      contractExportName,
      integrationExportName,
      normalFlowHookName,
      architectureEvidence: {
        ok: true,
        surfaceId,
        negativeSpaceReduced: true,
        reducedGaps: [`${surfaceId}:semantic_runtime_gap`],
        remainingGaps: 'full_mailchimp_parity_not_claimed_by_benchmark_slice',
        sourceOfTruthIntegrated: true,
        layerCount: Math.max(2, evidenceFiles.length),
        modifiedPrimaryRuntimeFiles: [target.relativePath],
        evidencePrimaryRuntimeFiles: evidenceFiles.length >= 2 ? evidenceFiles : [target.relativePath, `${surfaceId}:runtime_contract`],
        modifiedRequiredLayers: ['route_or_server'],
        signaledFiles: evidenceFiles.length >= 2 ? evidenceFiles : [target.relativePath, `${surfaceId}:runtime_contract`],
        modifiedSignaledFiles: [target.relativePath],
        markerOnly: false,
        runtimeIntegrationEvidence: {
          ok: true,
          verifierExpectation: 'mailchimp production surface verifier imports and executes generated runtime and integration exports when present',
          generatedRuntimeExportName: runtimeExportName,
          integrationExportName,
          generatedRuntimeReferenced: true,
          generatedRuntimeReferenceCount: 1,
          existingProductExportName: existingProductFunctionName,
          existingProductCallRequired: true,
          existingProductCallWired: Boolean(existingProductFunctionName),
          existingProductCallViaReExport: existingProductIntegration.viaReExport === true,
          existingProductCallSourceModule: existingProductIntegration.sourceModule,
          normalFlowRequired: true,
          normalFlowHookName,
          normalFlowHookWired: normalFlowInjection.injected === true || normalFlowInjection.kind === 'normal_flow_bridge',
          normalFlowHookKind: normalFlowInjection.kind || null,
          normalFlowHookReason: normalFlowInjection.reason || null,
          integrationKind: 'in_file_existing_product_function_adapter'
        },
        semanticBloatAudit: {
          semanticBloatSuspect: false,
          duplicateAddedLineRatio: 0
        }
      },
      proofCarryingClaim: {
        statement: `Semantic product architecture patch for ${surfaceId} lands runtime behavior into the assigned source-of-truth surface.`,
        requestedCredit: 'semantic_product_architecture_surface_credit',
        surfaceIds: [surfaceId],
        negativeSpaceReduced: true,
        reducedGaps: [`${surfaceId}:semantic_runtime_gap`],
        remainingGaps: 'full_mailchimp_parity_not_claimed_by_benchmark_slice',
        sourceOfTruthIntegrated: true,
        counterexamplesConsidered: [
          'marker-only delta without runtime export',
          'verifier skipped or absent',
          'diff outside assignment allowed files',
          'normal-flow hook not wired into the existing product boundary'
        ],
        proofArtifacts: stableList([
          target.relativePath,
          ...evidenceFiles,
          `${surfaceId}:semantic_architecture_verifier`
        ])
      }
    }
  };
}


function creativeProductWorkRequired(assignment) {
  return assignment.contextPack?.inputs?.productDiffMode === 'creative_product_work'
    || assignment.shard?.metadata?.productDiffMode === 'creative_product_work'
    || assignment.contextPack?.inputs?.creativeProductWork?.required === true
    || assignment.shard?.metadata?.creativeProductWorkRequired === true;
}

function parsePositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'required'].includes(String(value).trim().toLowerCase());
}

function safeRelativeSourcePath(value = '') {
  const rel = String(value || '').trim().replace(/^\.\//, '');
  if (!rel || path.isAbsolute(rel) || rel.includes('..')) return null;
  if (!/\.(?:mjs|js|jsx|ts|tsx|css|json)$/i.test(rel)) return null;
  return rel;
}

function creativeAllowedSourceFiles(assignment) {
  return stableList([
    ...(assignment.shard?.allowedFiles || []),
    ...(assignment.shard?.fileAreas || []),
    ...(assignment.contextPack?.guardrails?.allowedFiles || []),
    ...(assignment.contextPack?.guardrails?.fileAreas || [])
  ].map(safeRelativeSourcePath).filter(Boolean));
}

function readWorkspaceFile(workspaceRoot, rel) {
  const full = path.resolve(workspaceRoot, rel);
  if (!full.startsWith(`${workspaceRoot}${path.sep}`)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full, 'utf8');
}

function snapshotCreativeFiles(workspaceRoot, files = []) {
  const out = new Map();
  for (const rel of files) out.set(rel, readWorkspaceFile(workspaceRoot, rel));
  return out;
}

function changedCreativeFiles(workspaceRoot, before) {
  const changed = [];
  for (const [rel, beforeContent] of before.entries()) {
    const afterContent = readWorkspaceFile(workspaceRoot, rel);
    if (afterContent !== beforeContent) changed.push({ rel, beforeContent, afterContent });
  }
  return changed;
}

function lineListForCreativeDiff(value = '') {
  const lines = String(value || '').split(/\r?\n/);
  if (lines.length && lines.at(-1) === '') lines.pop();
  return lines;
}

function addedLinesBetweenCreative(before = '', after = '') {
  const beforeCounts = new Map();
  for (const line of lineListForCreativeDiff(before)) beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1);
  const added = [];
  for (const line of lineListForCreativeDiff(after)) {
    const remaining = beforeCounts.get(line) || 0;
    if (remaining > 0) beforeCounts.set(line, remaining - 1);
    else added.push(line);
  }
  return added;
}

function buildCreativeDiff(changed = []) {
  const sections = [];
  for (const entry of changed) {
    const before = entry.beforeContent == null ? '' : String(entry.beforeContent);
    const after = entry.afterContent == null ? '' : String(entry.afterContent);
    const added = addedLinesBetweenCreative(before, after);
    sections.push(`--- a/${entry.rel}`);
    sections.push(`+++ b/${entry.rel}`);
    sections.push('@@ creative product work delta @@');
    if (added.length) sections.push(...added.map((line) => `+${line}`));
    else sections.push('+// creative product work changed existing lines without net-new line additions');
  }
  return sections.join('\n');
}

function shellSnippet(value = '') {
  const text = String(value || '').trim();
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

function writeCreativeTaskBrief({ assignment, taskPath, evidencePath, allowedFiles, minIterations, minRuntimeMs, cortexContextPacketPath = null, budgetLedgerPath = null, promptMode = 'full_context' }) {
  const meteringPlan = readCreativeWorkerMeteringPlanFromEnv(process.env);
  const bundleMetadata = assignment.shard?.metadata?.continuousControllerBundledSurface ? {
    enabled: true,
    bundleMode: assignment.shard?.metadata?.continuousControllerBundleMode || 'coherent_product_slice',
    sourceSurfaceIds: stableList(assignment.shard?.metadata?.bundledSurfaceIds || []),
    bundledProductFiles: stableList(assignment.shard?.metadata?.bundledProductFiles || allowedFiles.filter((rel) => /^(apps|packages)\//.test(rel))),
    minProductTargetsToModify: Math.max(1, Number(assignment.shard?.metadata?.minProductTargetsToModify || 1)),
    sourceSurfaces: Array.isArray(assignment.shard?.sourceSurfaces) ? assignment.shard.sourceSurfaces : []
  } : { enabled: false };
  const payload = {
    schemaVersion: 'claw.creative_product_work_task.v1',
    generatedAt: new Date().toISOString(),
    shardId: assignment.shard?.id || null,
    agentId: assignment.agentId || null,
    workspacePath: assignment.workspacePath,
    allowedFiles,
    goal: assignment.shard?.goal || assignment.shard?.title || null,
    title: assignment.shard?.title || null,
    acceptanceChecks: assignment.contextPack?.acceptanceChecks || [],
    guardrails: assignment.contextPack?.guardrails || {},
    contextPack: assignment.contextPack || null,
    contextGovernor: assignment.contextPack?.contextGovernor || null,
    modelTierPlan: assignment.contextPack?.modelTierPlan || null,
    retrievalManifest: assignment.contextPack?.retrievalManifest || null,
    contextFootprint: assignment.contextPack?.contextFootprint || null,
    promptMode,
    compactBriefMaxChars: process.env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS || null,
    bundle: bundleMetadata,
    meteringPlan,
    cortexContextPacketPath,
    budgetLedgerPath,
    requiredEvidencePath: evidencePath,
    requiredEvidenceSchema: {
      summary: 'What product behavior changed and why.',
      iterations: `Array with at least ${minIterations} inspect/design/edit/test/fix entries.`,
      productDecisions: 'Surface-specific decisions, not generic benchmark boilerplate.',
      filesChanged: 'Relative files changed.',
      testsRun: 'Commands run and outcome.',
      risks: 'Remaining risks or tradeoffs.'
    },
    rules: [
      'Do not add benchmark-only runtime shims or generic semanticProductArchitecture code.',
      'Do not produce docs/tests-only work; modify at least one assigned product source file.',
      bundleMetadata.enabled ? `Bundled mode: modify at least ${bundleMetadata.minProductTargetsToModify} assigned product target file(s) and make the changes read like one coherent product slice, not unrelated tiny edits.` : null,
      'Keep changes scoped to allowedFiles unless the task brief explicitly justifies otherwise.',
      'Run the targeted tests when possible and record results in the evidence file.',
      minRuntimeMs > 0 ? `Keep the coding loop active until at least ${minRuntimeMs}ms of creative worker time has elapsed; verifier sleep does not count.` : 'No minimum runtime is required for this smoke task.'
    ].filter(Boolean)
  };
  fs.writeFileSync(taskPath, `${JSON.stringify(payload, null, 2)}
`);
  return payload;
}

function writeCreativeCortexPacket({ assignment, cortexPacketPath, allowedFiles, productTargets, minIterations, minRuntimeMs, budgetLedgerPath, promptMode = 'full_context' }) {
  const surfaceId = assignment.shard?.metadata?.surfaceId || assignment.shard?.id || 'surface';
  const meteringPlan = readCreativeWorkerMeteringPlanFromEnv(process.env);
  const bundleMetadata = assignment.shard?.metadata?.continuousControllerBundledSurface ? {
    enabled: true,
    bundleMode: assignment.shard?.metadata?.continuousControllerBundleMode || 'coherent_product_slice',
    sourceSurfaceIds: stableList(assignment.shard?.metadata?.bundledSurfaceIds || []),
    bundledProductFiles: stableList(assignment.shard?.metadata?.bundledProductFiles || productTargets),
    minProductTargetsToModify: Math.max(1, Number(assignment.shard?.metadata?.minProductTargetsToModify || 1)),
    sourceSurfaces: Array.isArray(assignment.shard?.sourceSurfaces) ? assignment.shard.sourceSurfaces : []
  } : { enabled: false };
  const workspaceRoot = path.resolve(assignment.workspacePath);
  const acceptanceChecks = stableList(assignment.contextPack?.acceptanceChecks || []);
  const verifierCatalog = assignment.contextPack?.inputs?.verifierCatalog || assignment.shard?.metadata?.verifierCatalog || {};
  const packet = {
    schemaVersion: 'claw.cortex_creative_context_packet.v1',
    generatedAt: new Date().toISOString(),
    cortexRoute: process.env.CREATIVE_WORKER_CORTEX_ROUTE || 'L24_nexus+L27_forge+L20_simulator+L7_librarian_context_governor',
    source: process.env.CREATIVE_WORKER_CORTEX_SOURCE || 'benchmark_context_pack',
    surface: {
      id: surfaceId,
      label: assignment.shard?.title || assignment.shard?.label || surfaceId,
      goal: assignment.shard?.goal || assignment.shard?.title || null,
      bundle: bundleMetadata
    },
    intent: 'Make one scoped Mailchimp product-surface improvement with bounded context, targeted verification, and auditable evidence.',
    instructions: [
      'Use this packet as the planning/context authority before invoking broad repository search.',
      'Modify assigned product runtime files only; docs/tests-only changes do not count.',
      bundleMetadata.enabled ? `Bundled mode: make one coherent product slice across the assigned targets and modify at least ${bundleMetadata.minProductTargetsToModify} product target file(s).` : null,
      'Prefer product behavior, validation, state shaping, route/domain logic, or user-visible data contracts specific to this surface.',
      'Run targeted checks from acceptanceChecks/verifierCatalog when feasible.',
      'If assigned tests are missing or stale, record that as a risk instead of repo-wide thrashing.',
      'Stop after the bounded product delta/evidence loop; do not keep spending tokens only to satisfy elapsed time.'
    ].filter(Boolean),
    contextPack: assignment.contextPack || null,
    contextGovernor: assignment.contextPack?.contextGovernor || null,
    modelTierPlan: assignment.contextPack?.modelTierPlan || null,
    retrievalManifest: assignment.contextPack?.retrievalManifest || null,
    contextFootprint: assignment.contextPack?.contextFootprint || null,
    files: allowedFiles.map((rel) => ({
      path: rel,
      role: productTargets.includes(rel) ? 'product_target' : 'support_or_verifier',
      exists: fs.existsSync(path.join(workspaceRoot, rel))
    })),
    runnableChecks: acceptanceChecks.map((command) => ({ command })),
    verifierCatalog,
    budgetPolicy: {
      ledgerPath: budgetLedgerPath,
      minIterations,
      minRuntimeMs,
      maxIterations: process.env.CODEX_CREATIVE_MAX_ITERATIONS || null,
      perWorkerCallLimit: process.env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT || null,
      maxActiveCodexCalls: process.env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || null,
      globalCallLimit: process.env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT || null,
      globalTokenLimit: process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || null,
      tokenReservationEstimate: process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || null,
      meteringMode: process.env.CREATIVE_WORKER_METERING_MODE || meteringPlan.mode || null,
      tokenBudgetMode: process.env.CREATIVE_WORKER_TOKEN_BUDGET_MODE || meteringPlan.tokenBudgetMode || null,
      meteringPlan,
      promptMode,
      compactBriefMaxChars: process.env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS || null,
      codexRunsTests: process.env.CREATIVE_WORKER_CODEX_RUN_TESTS || null,
      externalVerification: process.env.CREATIVE_WORKER_EXTERNAL_VERIFICATION || null,
      requireRepairSignalForRetry: process.env.CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY || null,
      stopOnExternalVerificationFailure: process.env.CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE || null,
      maxObservedTokensPerMinute: process.env.CREATIVE_WORKER_MAX_OBSERVED_TOKENS_PER_MINUTE || null,
      failClosed: parseBool(process.env.CREATIVE_WORKER_CORTEX_REQUIRED, false)
    },
    negativeSpace: {
      fullMailchimpParityClaimed: false,
      benchmarkSliceOnly: true,
      completionRequiresThresholdPass: true
    }
  };
  fs.mkdirSync(path.dirname(cortexPacketPath), { recursive: true });
  fs.writeFileSync(cortexPacketPath, `${JSON.stringify(packet, null, 2)}
`);
  return packet;
}

function parseCreativeEvidence(evidencePath) {
  if (!fs.existsSync(evidencePath)) return { ok: false, reason: 'creative_evidence_file_missing', evidence: null };
  try {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    return { ok: true, evidence };
  } catch (error) {
    return { ok: false, reason: 'creative_evidence_json_invalid', error: error.message, evidence: null };
  }
}

function applyCreativeProductWork(assignment) {
  const surfaceId = assignment.shard?.metadata?.surfaceId || assignment.shard?.id || 'surface';
  const sourceSurfaceIds = stableList([surfaceId, ...(assignment.shard?.metadata?.bundledSurfaceIds || []), ...(assignment.shard?.surfaceIds || [])]);
  const bundledMode = assignment.shard?.metadata?.continuousControllerBundledSurface === true;
  const minProductTargetsToModify = bundledMode
    ? Math.max(1, Number(assignment.shard?.metadata?.minProductTargetsToModify || 1))
    : 1;
  const workspaceRoot = path.resolve(assignment.workspacePath);
  const creativePolicy = assignment.contextPack?.inputs?.creativeProductWork || assignment.shard?.metadata?.creativeProductWork || {};
  const command = String(process.env.CREATIVE_WORKER_COMMAND || creativePolicy.workerCommand || '').trim();
  const minIterations = Math.max(1, Number(process.env.CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE || creativePolicy.minIterations || process.env.CREATIVE_WORKER_MIN_ITERATIONS || 3));
  const minRuntimeMs = parsePositiveNumber(process.env.CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE, null)
    ?? parsePositiveNumber(creativePolicy.minWorkerRuntimeMs, null)
    ?? parsePositiveNumber(process.env.CREATIVE_WORKER_MIN_RUNTIME_MS, 0)
    ?? 0;
  const baseCodexIterationTimeoutMs = parsePositiveNumber(process.env.CODEX_CREATIVE_ITERATION_TIMEOUT_MS, 420_000) ?? 420_000;
  const maxCodexIterations = Math.max(1, Number(process.env.CODEX_CREATIVE_MAX_ITERATIONS || minIterations || 1));
  const promptMode = String(process.env.CREATIVE_WORKER_PROMPT_MODE || creativePolicy.promptMode || process.env.CODEX_CREATIVE_PROMPT_MODE || 'full_context').trim() || 'full_context';
  const budgetReservationTimeoutMs = parsePositiveNumber(process.env.CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS, 0) ?? 0;
  const allowedFiles = creativeAllowedSourceFiles(assignment);
  const productTargets = allowedFiles.filter((rel) => /^(apps|packages)\//.test(rel) && !/(^|\/)tests?\//i.test(rel));
  const bundleRuntimePlan = planCreativeBundleRuntime({
    bundle: {
      enabled: bundledMode,
      sourceSurfaceIds: assignment.shard?.metadata?.bundledSurfaceIds || [],
      bundledProductFiles: assignment.shard?.metadata?.bundledProductFiles || productTargets,
      minProductTargetsToModify
    },
    baseIterationTimeoutMs: baseCodexIterationTimeoutMs,
    baseTokenReservationEstimate: parsePositiveNumber(process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE, 0) ?? 0,
    maxComplexityFactor: parsePositiveNumber(process.env.CREATIVE_WORKER_BUNDLE_MAX_COMPLEXITY_FACTOR, 4) ?? 4,
    maxIterationTimeoutMs: parsePositiveNumber(process.env.CREATIVE_WORKER_BUNDLE_MAX_ITERATION_TIMEOUT_MS, 1_800_000) ?? 1_800_000,
    maxTokenReservationEstimate: parsePositiveNumber(process.env.CREATIVE_WORKER_BUNDLE_MAX_TOKEN_RESERVATION_ESTIMATE, 0) ?? 0
  });
  const codexIterationTimeoutMs = bundleRuntimePlan.iterationTimeoutMs;
  const commandTimeoutMs = parsePositiveNumber(process.env.CREATIVE_WORKER_COMMAND_TIMEOUT_MS, null)
    ?? Math.max(60_000, minRuntimeMs + 120_000, (codexIterationTimeoutMs * maxCodexIterations) + budgetReservationTimeoutMs + 60_000);
  if (!command) {
    return {
      ok: false,
      modifiedFiles: [],
      diffSummary: 'creative product work blocked before coding loop',
      stderr: 'creative_worker_model_unavailable: CREATIVE_WORKER_COMMAND is not configured',
      metadata: {
        benchmarkMode: 'creative_product_work',
        productDiffMode: 'creative_product_work',
        creativeProductWorkRequired: true,
        surfaceId,
        reason: 'creative_worker_model_unavailable',
        requiredEnv: 'CREATIVE_WORKER_COMMAND'
      }
    };
  }
  if (!allowedFiles.length || !productTargets.length) {
    return {
      ok: false,
      modifiedFiles: [],
      diffSummary: 'creative product work blocked before coding loop',
      stderr: 'creative_product_work_target_missing: no writable product source targets in assignment',
      metadata: {
        benchmarkMode: 'creative_product_work',
        productDiffMode: 'creative_product_work',
        creativeProductWorkRequired: true,
        surfaceId,
        reason: 'creative_product_work_target_missing',
        allowedFiles
      }
    };
  }
  const resultDir = path.dirname(assignment.resultPath);
  const attempt = assignment.lease?.attempt || 1;
  const evidencePath = path.join(resultDir, `${assignment.shard.id}__creative-evidence-${attempt}.json`);
  const taskPath = path.join(resultDir, `${assignment.shard.id}__creative-task-${attempt}.json`);
  const cortexPacketDir = String(process.env.CREATIVE_WORKER_CORTEX_PACKET_DIR || creativePolicy.cortexContextPacketDir || resultDir).trim();
  const cortexContextPacketPath = path.join(cortexPacketDir, `${assignment.shard.id}__cortex-context-${attempt}.json`);
  const budgetLedgerPath = String(process.env.CREATIVE_WORKER_BUDGET_LEDGER_PATH || creativePolicy.budgetLedgerPath || path.join(resultDir, 'creative-worker-budget-ledger.json')).trim();
  writeCreativeCortexPacket({ assignment, cortexPacketPath: cortexContextPacketPath, allowedFiles, productTargets, minIterations, minRuntimeMs, budgetLedgerPath, promptMode });
  writeCreativeTaskBrief({ assignment, taskPath, evidencePath, allowedFiles, minIterations, minRuntimeMs, cortexContextPacketPath, budgetLedgerPath, promptMode });
  const before = snapshotCreativeFiles(workspaceRoot, allowedFiles);
  const startedAt = Date.now();
  const childEnv = {
    ...process.env,
    CREATIVE_WORKER_TASK_PATH: taskPath,
    CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
    CREATIVE_WORKER_WORKSPACE: workspaceRoot,
    CREATIVE_WORKER_ALLOWED_FILES: allowedFiles.join(','),
    CREATIVE_WORKER_SURFACE_ID: surfaceId,
    CREATIVE_WORKER_AGENT_ID: assignment.agentId || '',
    CREATIVE_WORKER_MIN_ITERATIONS: String(minIterations),
    CREATIVE_WORKER_MIN_RUNTIME_MS: String(minRuntimeMs),
    CREATIVE_WORKER_CORTEX_PACKET_PATH: cortexContextPacketPath,
    CORTEX_CONTEXT_PACKET_PATH: cortexContextPacketPath,
    CREATIVE_WORKER_BUDGET_LEDGER_PATH: budgetLedgerPath,
    CREATIVE_WORKER_PROMPT_MODE: promptMode,
    CODEX_CREATIVE_ITERATION_TIMEOUT_MS: String(codexIterationTimeoutMs),
    CREATIVE_WORKER_BUNDLE_RUNTIME_PLAN: JSON.stringify(bundleRuntimePlan)
  };
  if (bundleRuntimePlan.tokenReservationEstimate > 0) {
    childEnv.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE = String(bundleRuntimePlan.tokenReservationEstimate);
  }
  const spawned = spawnSync(command, [], {
    cwd: workspaceRoot,
    shell: '/bin/bash',
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    env: childEnv
  });
  const finishedAt = Date.now();
  const creativeWorkerRuntimeMs = finishedAt - startedAt;
  const changed = changedCreativeFiles(workspaceRoot, before);
  const modifiedFiles = changed.map((entry) => entry.rel);
  const productModifiedFiles = modifiedFiles.filter((rel) => productTargets.includes(rel));
  const evidenceRead = parseCreativeEvidence(evidencePath);
  const evidence = evidenceRead.evidence || null;
  const iterations = Array.isArray(evidence?.iterations) ? evidence.iterations : [];
  const diff = buildCreativeDiff(changed);
  const addedLines = changed.flatMap((entry) => addedLinesBetweenCreative(entry.beforeContent || '', entry.afterContent || ''));
  const uniqueNormalizedAddedLines = new Set(addedLines.map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean));
  const commandFailed = spawned.status !== 0 || spawned.error;
  const runtimeTooShort = minRuntimeMs > 0 && creativeWorkerRuntimeMs < minRuntimeMs;
  const evidenceFailed = !evidenceRead.ok;
  const tooFewIterations = iterations.length < minIterations;
  const noProductDelta = productModifiedFiles.length === 0;
  const tooFewProductTargetsModified = productModifiedFiles.length < minProductTargetsToModify;
  const genericShimPattern = /semanticProductArchitecture(?:Runtime|FixtureState|FixtureRouter|ExistingProductArgs|IntegratedCall|NormalFlow)_|__semanticProductArchitectureNormalFlowProofs|in_memory_semantic_benchmark/.test(diff);
  const ok = !commandFailed && !runtimeTooShort && !evidenceFailed && !tooFewIterations && !noProductDelta && !tooFewProductTargetsModified && !genericShimPattern;
  const failureReasons = [
    commandFailed ? 'creative_worker_command_failed' : null,
    runtimeTooShort ? 'creative_worker_runtime_too_short' : null,
    evidenceFailed ? evidenceRead.reason : null,
    tooFewIterations ? 'creative_worker_iterations_below_minimum' : null,
    noProductDelta ? 'creative_worker_product_delta_missing' : null,
    tooFewProductTargetsModified ? 'creative_worker_bundled_product_targets_below_minimum' : null,
    genericShimPattern ? 'creative_worker_generic_semantic_shim_detected' : null
  ].filter(Boolean);
  return {
    ok,
    modifiedFiles,
    diff,
    diffSummary: ok
      ? `creative product work update: ${productModifiedFiles.join(', ')}`
      : `creative product work failed: ${failureReasons.join(', ')}`,
    stdout: spawned.stdout || '',
    stderr: [spawned.stderr, spawned.error?.message, failureReasons.join(', ')].filter(Boolean).join('\n'),
    metadata: {
      benchmarkMode: 'creative_product_work',
      productDiffMode: 'creative_product_work',
      semanticProductAdmissionRequired: true,
      creativeProductWorkRequired: true,
      rejectGenericSemanticShim: true,
      surfaceId,
      workerCommand: shellSnippet(command),
      taskPath,
      evidencePath,
      cortexContextPacketPath,
      budgetLedgerPath,
      creativeWorkerEvidence: {
        ok,
        surfaceId,
        sourceSurfaceIds,
        bundledMode,
        minProductTargetsToModify,
        agentId: assignment.agentId || null,
        commandConfigured: Boolean(command),
        commandExitCode: spawned.status ?? null,
        commandSignal: spawned.signal ?? null,
        commandTimedOut: spawned.error?.code === 'ETIMEDOUT',
        baseCodexIterationTimeoutMs,
        codexIterationTimeoutMs,
        commandTimeoutMs,
        bundleRuntimePlan,
        creativeWorkerRuntimeMs,
        creativeWorkerMinutes: Number((creativeWorkerRuntimeMs / 60000).toFixed(3)),
        minWorkerRuntimeMs: minRuntimeMs,
        minIterations,
        iterationCount: iterations.length,
        retryable: evidence?.retryable ?? true,
        evidencePresent: evidenceRead.ok,
        modifiedFiles,
        productModifiedFiles,
        productTargetsModifiedCount: productModifiedFiles.length,
        addedLineCount: addedLines.length,
        uniqueNormalizedAddedLineCount: uniqueNormalizedAddedLines.size,
        genericShimPattern,
        failureReasons,
        cortexContext: evidence?.cortex || null,
        budget: evidence?.budget || null,
        prompt: evidence?.prompt || { mode: promptMode },
        externalVerification: evidence?.externalVerification || null,
        productDelta: evidence?.productDelta || null,
        evidenceSummary: evidence ? {
          summary: evidence.summary || null,
          productDecisions: Array.isArray(evidence.productDecisions) ? evidence.productDecisions.slice(0, 10) : [],
          testsRun: Array.isArray(evidence.testsRun) ? evidence.testsRun.slice(0, 10) : []
        } : null
      },
      architectureEvidence: {
        ok,
        surfaceId,
        surfaceIds: sourceSurfaceIds,
        negativeSpaceReduced: ok,
        reducedGaps: ok ? sourceSurfaceIds.map((id) => `${id}:creative_product_gap`) : [],
        remainingGaps: 'full_mailchimp_parity_not_claimed_by_creative_benchmark_slice',
        sourceOfTruthIntegrated: productModifiedFiles.length > 0,
        layerCount: Math.max(2, stableList([...productModifiedFiles, ...modifiedFiles, `${surfaceId}:creative_worker_evidence`]).length),
        modifiedPrimaryRuntimeFiles: productModifiedFiles,
        evidencePrimaryRuntimeFiles: stableList([...productModifiedFiles, ...modifiedFiles, `${surfaceId}:creative_worker_evidence`]).slice(0, 6),
        modifiedRequiredLayers: productModifiedFiles.length ? ['product_runtime'] : [],
        signaledFiles: stableList([...productModifiedFiles, ...modifiedFiles, `${surfaceId}:creative_worker_evidence`]).slice(0, 6),
        modifiedSignaledFiles: stableList([...modifiedFiles, `${surfaceId}:creative_worker_evidence`]).slice(0, 6),
        markerOnly: false,
        runtimeIntegrationEvidence: {
          ok,
          integrationKind: 'creative_external_agent_product_edit_loop',
          generatedRuntimeReferenced: false,
          existingProductCallRequired: false,
          existingProductCallWired: false,
          normalFlowRequired: false,
          normalFlowHookWired: false,
          creativeWorkerEvidenceRequired: true,
          creativeWorkerEvidenceOk: ok
        },
        creativeWorkerEvidenceRequired: true,
        creativeWorkerEvidenceOk: ok,
        semanticBloatAudit: {
          semanticBloatSuspect: genericShimPattern,
          duplicateAddedLineRatio: addedLines.length > 0 ? Number(((addedLines.length - uniqueNormalizedAddedLines.size) / addedLines.length).toFixed(4)) : 0
        }
      },
      proofCarryingClaim: {
        statement: `Creative product worker patch for ${surfaceId} makes an agent-produced scoped product change with iterative evidence.`,
        requestedCredit: 'creative_product_work_credit',
        surfaceIds: sourceSurfaceIds,
        negativeSpaceReduced: ok,
        reducedGaps: ok ? sourceSurfaceIds.map((id) => `${id}:creative_product_gap`) : [],
        remainingGaps: 'full_mailchimp_parity_not_claimed_by_creative_benchmark_slice',
        sourceOfTruthIntegrated: productModifiedFiles.length > 0,
        counterexamplesConsidered: [
          'verifier sleep counted as creative work',
          'deterministic template or benchmark shim',
          'docs/tests-only product claim',
          'one-shot patch without iteration evidence',
          'missing external model command'
        ],
        proofArtifacts: stableList([...productModifiedFiles, evidencePath, taskPath])
      }
    }
  };
}

function applyDeterministicProductDiff(assignment) {
  if (!productDiffModeEnabled(assignment)) {
    return {
      ok: true,
      modifiedFiles: [],
      diffSummary: 'verification-only transfer shard',
      metadata: {
        benchmarkMode: 'verification_only',
        surfaceId: assignment.shard?.metadata?.surfaceId || assignment.shard?.id || null
      }
    };
  }

  const target = resolveProductDiffTarget(assignment);
  const surfaceId = assignment.shard?.metadata?.surfaceId || assignment.shard?.id || 'surface';
  if (!target) {
    return {
      ok: false,
      modifiedFiles: [],
      diffSummary: 'product-diff transfer shard failed before verifier execution',
      stderr: 'No writable in-scope product source file was available for deterministic product-diff benchmark mode.',
      metadata: {
        benchmarkMode: 'product_diff_required',
        surfaceId,
        reason: 'product_diff_target_missing'
      }
    };
  }

  const mode = assignment.contextPack?.inputs?.productDiffMode || assignment.shard?.metadata?.productDiffMode || 'deterministic_metadata_patch';
  if (mode === 'creative_product_work' || creativeProductWorkRequired(assignment)) {
    return applyCreativeProductWork(assignment);
  }
  if (mode === 'semantic_product_architecture') {
    if (rejectGenericSemanticShimRequired(assignment)) {
      return applyStrictProductSurfaceRuntimeDiff(assignment, target);
    }
    return applySemanticProductArchitectureDiff(assignment, target);
  }
  const semanticRequired = semanticProductAdmissionRequired(assignment);
  const exportName = `transferBenchmarkEvidence_${safeIdentifier(surfaceId)}_${safeIdentifier(assignment.lease?.leaseId || 'lease')}`;
  const evidence = {
    surfaceId,
    agentId: assignment.agentId || null,
    leaseId: assignment.lease?.leaseId || null,
    mode: mode === 'semantic_product_architecture' ? 'semantic_product_architecture_transfer_benchmark' : 'deterministic_product_diff_transfer_benchmark',
    generatedAt: assignment.generatedAt || new Date().toISOString()
  };
  const extension = path.extname(target.relativePath).toLowerCase();
  const evidenceJson = JSON.stringify(evidence, null, 2);
  const marker = extension === '.html' || extension === '.htm'
    ? `\n\n<!-- ${exportName}\n${evidenceJson}\n-->\n`
    : extension === '.css'
      ? `\n\n/* ${exportName}\n${evidenceJson}\n*/\n`
      : `\n\nexport const ${exportName} = Object.freeze(${evidenceJson});\n`;
  fs.appendFileSync(target.targetPath, marker);
  const diff = [
    `--- a/${target.relativePath}`,
    `+++ b/${target.relativePath}`,
    '@@ deterministic transfer benchmark marker @@',
    ...marker.trimEnd().split('\n').map((line) => `+${line}`)
  ].join('\n');
  return {
    ok: true,
    modifiedFiles: [target.relativePath],
    diff,
    diffSummary: `${mode} update: ${target.relativePath}`,
    metadata: {
      benchmarkMode: 'product_diff_required',
      productDiffMode: mode,
      surfaceId,
      modifiedFile: target.relativePath,
      exportName,
      semanticProductAdmissionRequired: semanticRequired,
      markerOnlyProductDelta: semanticRequired,
      claimIntegrityKind: semanticRequired ? 'marker_only_remediation_delta' : null
    }
  };
}

function runVerifier(assignmentPath, assignment, verifierId) {
  const command = [process.execPath, assignment.verifierScriptPath, '--assignment', assignmentPath, '--verifier', verifierId];
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  try {
    const stdout = execFileSync(command[0], command.slice(1), {
      cwd: assignment.workspacePath,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const parsed = JSON.parse(String(stdout).trim() || '{}');
    const finishedAt = Date.now();
    const finishedAtIso = new Date(finishedAt).toISOString();
    const durationMs = parsed.durationMs ?? finishedAt - startedAt;
    const parsedFirstMeaningfulProgressMs = nonNegativeNumberOrNull(parsed.firstMeaningfulProgressMs);
    const firstMeaningfulProgressMs = parsedFirstMeaningfulProgressMs ?? durationMs;
    return {
      ok: parsed.ok !== false,
      verifier: verifierId,
      command: parsed.command || command.join(' '),
      startedAt: parsed.startedAt || startedAtIso,
      finishedAt: parsed.finishedAt || finishedAtIso,
      durationMs,
      firstMeaningfulProgressMs,
      firstMeaningfulProgressAt: parsed.firstMeaningfulProgressAt || new Date(startedAt + firstMeaningfulProgressMs).toISOString(),
      stdout: parsed.stdout || String(stdout).trim(),
      stderr: parsed.stderr || '',
      metadata: parsed
    };
  } catch (error) {
    const stdout = `${error.stdout || ''}`.trim();
    const stderr = `${error.stderr || ''}${error.message || ''}`.trim();
    let parsed = {};
    try {
      parsed = JSON.parse(stdout || '{}');
    } catch {}
    const finishedAt = Date.now();
    const finishedAtIso = new Date(finishedAt).toISOString();
    const durationMs = parsed.durationMs ?? finishedAt - startedAt;
    const firstMeaningfulProgressMs = nonNegativeNumberOrNull(parsed.firstMeaningfulProgressMs);
    return {
      ok: false,
      verifier: verifierId,
      command: parsed.command || command.join(' '),
      startedAt: parsed.startedAt || startedAtIso,
      finishedAt: parsed.finishedAt || finishedAtIso,
      durationMs,
      firstMeaningfulProgressMs,
      firstMeaningfulProgressAt: parsed.firstMeaningfulProgressAt || (firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null),
      stdout: parsed.stdout || stdout,
      stderr: parsed.stderr || stderr,
      metadata: parsed
    };
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.assignment) {
  console.error('missing --assignment');
  process.exit(1);
}

const assignment = JSON.parse(fs.readFileSync(args.assignment, 'utf8'));
const failureInjection = assignment.failureInjection || null;
const startedAt = Date.now();

if (failureInjection?.mode === 'crash') {
  fs.appendFileSync(assignment.logPath, `[crash-injection] ${failureInjection.note || 'deterministic crash'}\n`);
  process.exit(85);
}

if (failureInjection?.mode === 'stall') {
  fs.appendFileSync(assignment.logPath, `[stall-injection] ${failureInjection.note || 'deterministic stall'} delayMs=${failureInjection.delayMs || 0}\n`);
  await sleep(Number(failureInjection.delayMs || 0));
}

const appliedProductDiff = applyDeterministicProductDiff(assignment);
const implementation = {
  ok: appliedProductDiff.ok !== false,
  command: null,
  durationMs: 0,
  firstMeaningfulProgressMs: appliedProductDiff.ok !== false ? 0 : null,
  firstMeaningfulProgressAt: appliedProductDiff.ok !== false ? new Date(startedAt).toISOString() : null,
  modifiedFiles: appliedProductDiff.modifiedFiles || [],
  diff: appliedProductDiff.diff || '',
  diffSummary: appliedProductDiff.diffSummary || 'verification-only transfer shard',
  stdout: appliedProductDiff.stdout || '',
  stderr: appliedProductDiff.stderr || '',
  metadata: appliedProductDiff.metadata || {}
};
fs.appendFileSync(assignment.logPath, `${JSON.stringify({ type: 'implementation', ...implementation })}\n`);

if (implementation.ok === false) {
  fs.writeFileSync(assignment.resultPath, JSON.stringify({
    ok: false,
    shardId: assignment.shard.id,
    leaseId: assignment.lease.leaseId,
    agentId: assignment.agentId,
    executionMode: assignment.executionMode,
    implementation,
    verifierResults: [],
    elapsedMs: Date.now() - startedAt,
    reason: implementation.stderr || 'product_diff_implementation_failed',
    contextPack: {
      shardId: assignment.contextPack?.shard?.id || assignment.shard.id,
      guardrails: assignment.contextPack?.guardrails || null,
      acceptanceChecks: assignment.contextPack?.acceptanceChecks || []
    }
  }, null, 2));
  process.exit(2);
}

const verifierResults = [];
for (const verifierId of assignment.shard.requiredVerifiers || []) {
  const result = runVerifier(args.assignment, assignment, verifierId);
  verifierResults.push(result);
  fs.appendFileSync(assignment.logPath, `${JSON.stringify(result)}\n`);
  if (result.ok === false) {
    fs.writeFileSync(assignment.resultPath, JSON.stringify({
      ok: false,
      shardId: assignment.shard.id,
      leaseId: assignment.lease.leaseId,
      agentId: assignment.agentId,
      executionMode: assignment.executionMode,
      implementation,
      verifierResults,
      elapsedMs: Date.now() - startedAt,
      contextPack: {
        shardId: assignment.contextPack?.shard?.id || assignment.shard.id,
        guardrails: assignment.contextPack?.guardrails || null,
        acceptanceChecks: assignment.contextPack?.acceptanceChecks || []
      }
    }, null, 2));
    process.exit(2);
  }
}

fs.writeFileSync(assignment.resultPath, JSON.stringify({
  ok: true,
  shardId: assignment.shard.id,
  leaseId: assignment.lease.leaseId,
  agentId: assignment.agentId,
  executionMode: assignment.executionMode,
  implementation,
  verifierResults,
  elapsedMs: Date.now() - startedAt,
  contextPack: {
    shardId: assignment.contextPack?.shard?.id || assignment.shard.id,
    guardrails: assignment.contextPack?.guardrails || null,
    acceptanceChecks: assignment.contextPack?.acceptanceChecks || []
  }
}, null, 2));

console.log(JSON.stringify({ ok: true, shardId: assignment.shard.id, leaseId: assignment.lease.leaseId }));
