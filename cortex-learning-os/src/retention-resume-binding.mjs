import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Text } from './hash.mjs';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function digestRecord(record) {
  return sha256Text(canonicalJson(record));
}

function differs(left, right) {
  return canonicalJson(left) !== canonicalJson(right);
}

export function retentionResumeBindingErrors({ bundle, wait } = {}) {
  const errors = [];
  if (!isRecord(wait) || wait.fixtureOnly !== false) {
    return ['production retention resume requires one authenticated production wait'];
  }
  if (!isRecord(bundle)) {
    return ['production retention resume bundle must be an object'];
  }

  const task = bundle.task;
  const bank = bundle.assessmentBank;
  const campaignBinding = wait.campaignBinding;
  if (!isRecord(campaignBinding)
      || differs(bundle.campaignBinding, campaignBinding)
      || differs(task?.assessmentCampaign, campaignBinding)
      || differs(bank?.bindings?.campaign, campaignBinding)) {
    errors.push('production retention resume campaign differs across wait, bundle, task, or assessment bank');
  }
  if (!isRecord(task)
      || task.fixtureOnly !== false
      || task.subjectId !== wait.subjectId
      || task.deploymentDigest !== wait.deploymentDigest
      || task.acquisitionBinding?.stateDigest !== wait.acquisitionStateDigest) {
    errors.push('production retention resume task scope differs from the signed wait');
  }
  if (!isRecord(task)
      || task.windowIndex !== wait.nextWindowIndex
      || task.previousWindowDigest !== wait.previousWindowDigest) {
    errors.push('production retention resume task window or predecessor differs from the signed wait');
  }
  if (!isRecord(task)
      || task.notBefore !== wait.resumeAt) {
    errors.push('production retention resume task due time differs from the signed wait');
  }
  if (!isRecord(task)
      || digestRecord(task) !== wait.dueTaskDigest) {
    errors.push('production retention resume task digest differs from the signed wait');
  }
  if (!isRecord(bank)
      || task?.assessmentBankRecordDigest !== digestRecord(bank)
      || task?.assessmentBankId !== bank?.bankId
      || task?.sealedItemBankDigest !== bank?.bankDigest) {
    errors.push('production retention resume assessment bank differs from the signed due task');
  }

  if (Object.hasOwn(bundle, 'subjectId') && bundle.subjectId !== wait.subjectId) {
    errors.push('production retention resume top-level subject differs from the signed wait');
  }
  if (Object.hasOwn(bundle, 'status') && (
    !isRecord(bundle.status)
    || digestRecord(bundle.status) !== wait.sourceStatusDigest
    || bundle.status.subjectId !== wait.subjectId
    || differs(bundle.status.campaignBinding, campaignBinding)
    || bundle.status.deploymentDigest !== wait.deploymentDigest
    || bundle.status.acquisitionStateDigest !== wait.acquisitionStateDigest
    || bundle.status.completedWindowCount + 1 !== wait.nextWindowIndex
    || (bundle.status.windowEvidenceDigests?.at(-1) ?? null)
      !== wait.previousWindowDigest
  )) {
    errors.push('production retention resume status alias differs from the signed wait source');
  }
  if (Object.hasOwn(bundle, 'campaign') && (
    !isRecord(bundle.campaign)
    || bundle.campaign.campaignId !== campaignBinding?.campaignId
    || digestRecord(bundle.campaign) !== campaignBinding?.campaignDigest
  )) {
    errors.push('production retention resume campaign alias differs from the signed wait');
  }
  if (Object.hasOwn(bundle, 'qualificationPlan') && (
    !isRecord(bundle.qualificationPlan)
    || bundle.qualificationPlan.subjectId !== wait.subjectId
    || bundle.qualificationPlan.campaignId !== campaignBinding?.campaignId
    || bundle.qualificationPlan.campaignDigest !== campaignBinding?.campaignDigest
  )) {
    errors.push('production retention resume qualification plan differs from the signed wait');
  }
  if (Object.hasOwn(bundle, 'previousWindow') && (
    wait.previousWindowDigest === null
      ? bundle.previousWindow !== null
      : !isRecord(bundle.previousWindow)
        || digestRecord(bundle.previousWindow) !== wait.previousWindowDigest
  )) {
    errors.push('production retention resume predecessor evidence differs from the signed wait');
  }
  return errors;
}

export function assertRetentionResumeBindings({ bundle, wait } = {}) {
  const errors = retentionResumeBindingErrors({ bundle, wait });
  if (errors.length > 0) throw new Error(errors.join('; '));
  return true;
}
