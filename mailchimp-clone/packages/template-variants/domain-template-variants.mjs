const PROGRAM = {
  id: "template-variants",
  name: "Template Variants",
  focus: "Template Variants extends the real-repo expansion with template variant catalogs, testing cohorts, and performance summaries.",
  themes: ["template", "variants"],
  metrics: ["variants", "tests", "lift", "adoption"],
  lanes: ["compose", "compare", "promote", "archive"]
};

export function createTemplateVariantsWorkspace(workspaceName = 'Wave 6 workspace') {
  return {
    ...PROGRAM,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: PROGRAM.metrics.map((metric, index) => ({
      id: metric,
      label: metric.replace(/-/g, ' '),
      currentValue: 22 + (index * 5),
      targetValue: 34 + (index * 7),
      posture: index % 2 === 0 ? 'healthy' : 'watch',
      narrative: "Template Variants" + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: "template-variants" + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: "Template Variants" + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarizeTemplateVariants(workspace = createTemplateVariantsWorkspace()) {
  return {
    id: workspace.id,
    name: workspace.name,
    focus: workspace.focus,
    workspaceName: workspace.workspaceName,
    metricCount: workspace.scorecards.length,
    activePrograms: workspace.programs.filter((entry) => entry.status === 'active').length,
    watchMetrics: workspace.scorecards.filter((entry) => entry.posture === 'watch').map((entry) => entry.id)
  };
}

export function createTemplateVariantsNarratives(workspace = createTemplateVariantsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}

export function createTemplateVariantExperimentMatrix(workspace = createTemplateVariantsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: `${program.id}-experiment`,
    lane: program.lane,
    cohort: index % 2 === 0 ? 'high_intent' : 'broad_reach',
    hypothesis: `${workspace.name} can improve ${workspace.metrics[index % workspace.metrics.length]} by promoting ${program.lane} variants.`,
    confidence: 0.68 + (index * 0.05),
    rollout: index === 0 ? 'pilot' : index === 1 ? 'review' : index === 2 ? 'expand' : 'archive',
    proofPoints: [
      `${program.lane} ownership is explicit`,
      `${workspace.metrics[index % workspace.metrics.length]} is measurable`,
      'Template reuse can be compared across cohorts'
    ]
  }));
}

export function summarizeVariantPromotionQueue(workspace = createTemplateVariantsWorkspace()) {
  const experiments = createTemplateVariantExperimentMatrix(workspace);
  return {
    workspaceId: workspace.id,
    activeExperiments: experiments.filter((entry) => entry.rollout !== 'archive').length,
    pilotCount: experiments.filter((entry) => entry.rollout === 'pilot').length,
    expansionCount: experiments.filter((entry) => entry.rollout === 'expand').length,
    topHypotheses: experiments.slice(0, 3).map((entry) => entry.hypothesis)
  };
}
