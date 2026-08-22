import {
  assertMailchimpContractReady,
  emitMailchimpContract,
} from '../compiler/contract-emitter.mjs';
import {
  assertMailchimpMemoryGuideReady,
  buildMailchimpMemoryGuideContract,
} from './memory-guide.mjs';
import {
  assertMailchimpRecoveryGuideReady,
  buildMailchimpRecoveryGuidePlan,
} from './recovery-guide.mjs';
import {
  assertMailchimpRuntimeGuideReady,
  buildMailchimpRuntimeGuideHandoff,
} from './runtime-guide.mjs';

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : String(value).split(',');
  return Array.from(new Set(list.map(compactString).filter(Boolean))).sort();
}

function stableContractValue(value) {
  if (Array.isArray(value)) return value.map(stableContractValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((next, key) => {
    if (value[key] !== undefined) next[key] = stableContractValue(value[key]);
    return next;
  }, {});
}

function stableHash(value) {
  const source = JSON.stringify(stableContractValue(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function summarizeCapabilities(contract, memoryGuide, runtimeGuide) {
  return stableList([
    ...(contract.runtimeDataContract?.requiredCapabilities || []),
    ...(contract.metadata?.capabilities?.actions || []),
    ...(memoryGuide.providerSync.requiredCapabilities || []),
    ...(runtimeGuide.adapterHandoff.capabilities || []),
  ]);
}

function countBy(list, selector) {
  return (Array.isArray(list) ? list : []).reduce((counts, item) => {
    const key = compactString(selector(item) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildGuideAnalytics(contract, memoryGuide, runtimeGuide, recoveryGuide, readiness) {
  const diagnostics = memoryGuide.diagnostics || [];
  const statusEvents = runtimeGuide.statusLedger?.events || [];
  const recoveryItems = recoveryGuide.recoveryItems || [];
  const checks = readiness.checks || [];
  const blockedReasons = stableList([
    ...(readiness.validationSummary?.blockingReasons || []),
    ...(memoryGuide.boundaryLedger?.blockedReasons || []),
    ...(runtimeGuide.operationalHealth?.hardFailures || []),
    ...(recoveryGuide.exportSummary?.blockedReasons || []),
  ]);

  return {
    counters: {
      checksTotal: checks.length,
      checksPassing: checks.filter((check) => check.ok).length,
      checksFailing: checks.filter((check) => !check.ok).length,
      memoryMounts: memoryGuide.mountLedger.length,
      providerSyncMounts: memoryGuide.providerSync.mounts.length,
      memoryDiagnostics: diagnostics.length,
      memoryErrors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
      boundaryBlocks: memoryGuide.boundaryLedger?.blockedReasons?.length || 0,
      runtimeEvents: statusEvents.length,
      runtimeHardFailures: runtimeGuide.operationalHealth?.hardFailures?.length || 0,
      runtimeDegradedReasons: runtimeGuide.operationalHealth?.degradedReasons?.length || 0,
      actionableErrors: runtimeGuide.actionableErrors?.length || 0,
      recoveryItems: recoveryItems.length,
      recoveryOperatorItems: recoveryItems.filter((item) => item.requiresOperator).length,
      recoveryUnrecoverableItems: recoveryItems.filter((item) => item.recoverable === false).length,
    },
    byStatus: {
      compiler: countBy(checks, (check) => check.status),
      memoryDiagnostics: countBy(diagnostics, (diagnostic) => diagnostic.severity),
      runtimeEvents: countBy(statusEvents, (event) => event.state),
      recoveryItems: countBy(recoveryItems, (item) => item.action),
    },
    blockedReasons,
    exportReady: readiness.acceptedForExport === true && blockedReasons.length === 0,
    tenantScope: memoryGuide.boundaryLedger?.tenantScope
      || runtimeGuide.operationalHealth?.boundary?.tenantScope
      || null,
  };
}

function buildTimelineSnapshot(stage, status, nextAction, detail = {}) {
  return {
    stage,
    status: compactString(status || 'unknown'),
    nextAction: compactString(nextAction || 'observe'),
    detail: stableContractValue(detail),
  };
}

function buildCompilerTimeline(contractReady, memoryGuide, runtimeGuide, recoveryGuide, readiness) {
  return [
    buildTimelineSnapshot(
      'contract',
      contractReady.status || (contractReady.ok ? 'ready' : 'blocked'),
      contractReady.nextAction,
      {
        ok: contractReady.ok === true,
        blockedReasons: contractReady.blockedReasons || [],
      },
    ),
    buildTimelineSnapshot(
      'memory',
      memoryGuide.readiness.status,
      memoryGuide.readiness.nextAction,
      {
        acceptedForRuntime: memoryGuide.readiness.acceptedForRuntime,
        boundaryBlocked: memoryGuide.readiness.boundaryBlocked,
        mounts: memoryGuide.mountLedger.map((mount) => mount.name),
      },
    ),
    buildTimelineSnapshot(
      'runtime',
      runtimeGuide.readiness.status,
      runtimeGuide.readiness.nextAction,
      {
        healthState: runtimeGuide.operationalHealth?.state,
        retryAfterSeconds: runtimeGuide.readiness.retryAfterSeconds,
        errors: runtimeGuide.actionableErrors?.map((error) => error.code) || [],
      },
    ),
    buildTimelineSnapshot(
      'recovery',
      recoveryGuide.readiness.status,
      recoveryGuide.readiness.nextAction,
      {
        acceptedForResume: recoveryGuide.readiness.acceptedForResume,
        resumeCommand: recoveryGuide.statusHandoff?.resumeCommand,
        blockedReasons: recoveryGuide.statusHandoff?.blockedReasons || [],
      },
    ),
    buildTimelineSnapshot(
      'export',
      readiness.status,
      readiness.nextAction,
      {
        acceptedForRuntime: readiness.acceptedForRuntime,
        acceptedForExport: readiness.acceptedForExport,
        blockingReasons: readiness.validationSummary.blockingReasons,
      },
    ),
  ];
}

function buildExportReport(exportEnvelope, analytics, timeline) {
  return {
    provider: exportEnvelope.provider,
    contractHash: exportEnvelope.contractHash,
    exportReady: analytics.exportReady,
    nextAction: exportEnvelope.nextAction,
    counters: analytics.counters,
    blockedReasons: analytics.blockedReasons,
    firstBlockedStage: timeline.find((item) => item.status === 'blocked' || item.status === 'hold')?.stage || null,
    timeline,
  };
}

function buildCompilerReadiness(contractReady, memoryReady, runtimeReady, recoveryReady) {
  const checks = [
    { id: 'mailchimp.compiler.contract', ...contractReady, required: true },
    { id: 'mailchimp.compiler.memory', ...memoryReady, required: true },
    { id: 'mailchimp.compiler.runtime', ...runtimeReady, required: true },
    { id: 'mailchimp.compiler.recovery', ...recoveryReady, required: false },
  ];
  const failedRequired = checks.filter((check) => check.required && !check.ok);
  const failedOptional = checks.filter((check) => !check.required && !check.ok);
  return {
    status: failedRequired.length
      ? 'blocked'
      : failedOptional.length
        ? 'ready_with_recovery_holds'
        : 'ready',
    acceptedForRuntime: failedRequired.length === 0,
    acceptedForExport: failedRequired.length === 0 && contractReady.ok === true,
    nextAction: failedRequired[0]?.nextAction
      || failedOptional[0]?.nextAction
      || 'export_mailchimp_kernel_contract',
    checks,
    validationSummary: {
      total: checks.length,
      failedRequired: failedRequired.length,
      failedOptional: failedOptional.length,
      blockingReasons: stableList(failedRequired.flatMap((check) => check.blockedReasons || [])),
    },
  };
}

export function compileMailchimpGuideBundle(source = {}, options = {}) {
  const contract = emitMailchimpContract(source, options);
  const contractReady = assertMailchimpContractReady(contract);
  const memoryGuide = buildMailchimpMemoryGuideContract(source.memory || source, {
    ...options.memory,
    jobId: options.jobId || source.jobId || contract.job?.id,
  });
  const runtimeGuide = buildMailchimpRuntimeGuideHandoff(source.runtime || source, {
    ...options.runtime,
    memoryContract: memoryGuide.memoryContract,
    memoryBoundary: memoryGuide.boundaryLedger,
    auditHandoff: memoryGuide.boundaryLedger.auditHandoff,
    tenantScope: memoryGuide.boundaryLedger.tenantScope,
  });
  const recoveryGuide = buildMailchimpRecoveryGuidePlan(source.recovery || source, {
    ...options.recovery,
    statusSnapshot: runtimeGuide.statusSnapshot,
  });
  const memoryReady = assertMailchimpMemoryGuideReady(memoryGuide);
  const runtimeReady = assertMailchimpRuntimeGuideReady(runtimeGuide);
  const recoveryReady = assertMailchimpRecoveryGuideReady(recoveryGuide);
  const readiness = buildCompilerReadiness(contractReady, memoryReady, runtimeReady, recoveryReady);
  const requiredCapabilities = summarizeCapabilities(contract, memoryGuide, runtimeGuide);
  const exportEnvelope = {
    provider: 'mailchimp',
    contractHash: stableHash({
      contract: contract.runtimeDataContract,
      memory: memoryGuide.mountLedger,
      runtime: runtimeGuide.descriptorSummary,
      recovery: recoveryGuide.statusHandoff,
    }),
    requiredCapabilities,
    requiredMemoryMounts: memoryGuide.mountLedger.map((mount) => mount.name),
    nextAction: readiness.nextAction,
  };
  const analytics = buildGuideAnalytics(contract, memoryGuide, runtimeGuide, recoveryGuide, readiness);
  const timeline = buildCompilerTimeline(contractReady, memoryGuide, runtimeGuide, recoveryGuide, readiness);
  const exportReport = buildExportReport(exportEnvelope, analytics, timeline);

  return {
    kind: 'aios.docsRuntime.compilerGuide.mailchimp.v1',
    provider: 'mailchimp',
    contract,
    memoryGuide,
    runtimeGuide,
    recoveryGuide,
    readiness,
    analytics,
    timeline,
    exportReport,
    exportEnvelope,
    kernelContract: {
      job: contract.job,
      runtimeDataContract: contract.runtimeDataContract,
      adapterHandoff: runtimeGuide.adapterHandoff,
      memory: memoryGuide.memoryContract,
      status: runtimeGuide.statusLedger,
      recovery: recoveryGuide.statusHandoff,
      audit: memoryGuide.boundaryLedger.auditHandoff,
      tenantScope: memoryGuide.boundaryLedger.tenantScope,
      analytics: {
        counters: analytics.counters,
        blockedReasons: analytics.blockedReasons,
      },
      claims: contract.metadata?.claims || contract.claims || [],
      verifier: contract.metadata?.verifier || contract.verifier || null,
      capabilities: requiredCapabilities,
    },
  };
}

export function assertMailchimpGuideBundleReady(bundle) {
  const target = bundle?.kind === 'aios.docsRuntime.compilerGuide.mailchimp.v1'
    ? bundle
    : compileMailchimpGuideBundle(bundle || {});
  return {
    ok: target.readiness.acceptedForRuntime === true && target.readiness.acceptedForExport === true,
    status: target.readiness.status,
    nextAction: target.readiness.nextAction,
    contractHash: target.exportEnvelope.contractHash,
    exportReady: target.exportReport.exportReady,
    analytics: target.analytics.counters,
    validationSummary: target.readiness.validationSummary,
  };
}
