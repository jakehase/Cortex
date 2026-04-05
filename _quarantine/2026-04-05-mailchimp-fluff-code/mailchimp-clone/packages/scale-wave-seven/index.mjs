import { growthChunk01 } from './groups/growth-chunk-01.mjs';
import { growthChunk02 } from './groups/growth-chunk-02.mjs';
import { growthChunk03 } from './groups/growth-chunk-03.mjs';
import { growthChunk04 } from './groups/growth-chunk-04.mjs';
import { growthChunk05 } from './groups/growth-chunk-05.mjs';
import { growthChunk06 } from './groups/growth-chunk-06.mjs';
import { revenueChunk01 } from './groups/revenue-chunk-01.mjs';
import { revenueChunk02 } from './groups/revenue-chunk-02.mjs';
import { revenueChunk03 } from './groups/revenue-chunk-03.mjs';
import { revenueChunk04 } from './groups/revenue-chunk-04.mjs';
import { revenueChunk05 } from './groups/revenue-chunk-05.mjs';
import { trustChunk01 } from './groups/trust-chunk-01.mjs';
import { trustChunk02 } from './groups/trust-chunk-02.mjs';
import { trustChunk03 } from './groups/trust-chunk-03.mjs';
import { intelligenceChunk01 } from './groups/intelligence-chunk-01.mjs';
import { intelligenceChunk02 } from './groups/intelligence-chunk-02.mjs';
import { intelligenceChunk03 } from './groups/intelligence-chunk-03.mjs';
import { intelligenceChunk04 } from './groups/intelligence-chunk-04.mjs';
import { lifecycleChunk01 } from './groups/lifecycle-chunk-01.mjs';
import { lifecycleChunk02 } from './groups/lifecycle-chunk-02.mjs';
import { lifecycleChunk03 } from './groups/lifecycle-chunk-03.mjs';
import { lifecycleChunk04 } from './groups/lifecycle-chunk-04.mjs';
import { lifecycleChunk05 } from './groups/lifecycle-chunk-05.mjs';
import { lifecycleChunk06 } from './groups/lifecycle-chunk-06.mjs';
import { APP_SHELLS, GROUPS } from './meta.mjs';

const GROUP_MODULES = {
  "growth": [...growthChunk01, ...growthChunk02, ...growthChunk03, ...growthChunk04, ...growthChunk05, ...growthChunk06],
  "revenue": [...revenueChunk01, ...revenueChunk02, ...revenueChunk03, ...revenueChunk04, ...revenueChunk05],
  "trust": [...trustChunk01, ...trustChunk02, ...trustChunk03],
  "intelligence": [...intelligenceChunk01, ...intelligenceChunk02, ...intelligenceChunk03, ...intelligenceChunk04],
  "lifecycle": [...lifecycleChunk01, ...lifecycleChunk02, ...lifecycleChunk03, ...lifecycleChunk04, ...lifecycleChunk05, ...lifecycleChunk06]
};

function hydrateGroups() {
  return GROUPS.map((group) => ({
    ...group,
    modules: GROUP_MODULES[group.id] || []
  }));
}

export function createScaleWaveSevenCatalog() {
  return hydrateGroups().map((group) => ({ ...group, modules: group.modules.map((module) => ({ ...module })) }));
}

export function summarizeScaleWaveSevenCatalog(groups = createScaleWaveSevenCatalog()) {
  const totalModules = groups.reduce((sum, group) => sum + group.modules.length, 0);
  return {
    groupCount: groups.length,
    totalModules,
    totalMetrics: groups.reduce((sum, group) => sum + group.modules.reduce((inner, module) => inner + module.metricCount, 0), 0),
    totalLanes: groups.reduce((sum, group) => sum + group.modules.reduce((inner, module) => inner + module.laneCount, 0), 0)
  };
}

export function createScaleWaveSevenHighlights(groups = createScaleWaveSevenCatalog()) {
  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    moduleCount: group.modules.length,
    sampleModules: group.modules.slice(0, 8)
  }));
}

export function createScaleWaveSevenAppShellCatalog(groups = createScaleWaveSevenCatalog()) {
  return APP_SHELLS.map((shell) => ({
    ...shell,
    groups: groups.filter((group) => shell.groupIds.includes(group.id)),
    totalModules: groups.filter((group) => shell.groupIds.includes(group.id)).reduce((sum, group) => sum + group.modules.length, 0)
  }));
}

