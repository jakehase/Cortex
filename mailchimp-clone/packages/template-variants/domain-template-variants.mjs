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


export function createCampaignEditorVariantCatalog(workspace = createTemplateVariantsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-editor-variant',
    lane: program.lane,
    layout: index % 2 === 0 ? 'story' : 'promo',
    dropZone: index === 0 ? 'hero' : index === 1 ? 'body' : index === 2 ? 'cta' : 'footer',
    approvalState: index < 2 ? 'ready_for_review' : 'draft',
    recommendedBlocks: ['headline', 'image', 'body', 'button'].slice(0, 2 + (index % 3)),
    narrative: workspace.name + ' variant ' + (index + 1) + ' keeps the campaign editor stocked with reusable layouts.'
  }));
}

export function createTemplateVariantExperimentMatrix(workspace = createTemplateVariantsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: `${program.id}-experiment-${index + 1}`,
    lane: program.lane,
    variantA: index % 2 === 0 ? 'story-led' : 'proof-led',
    variantB: index % 2 === 0 ? 'offer-led' : 'urgency-led',
    audienceSplit: index === 0 ? '50/50' : '60/40',
    primaryMetric: index < 2 ? 'click_rate' : 'conversion_rate',
    status: index < 2 ? 'active' : index === 2 ? 'queued' : 'ready_to_promote',
    liftEstimate: Number((4.5 + index * 1.2).toFixed(1))
  }));
}

export function summarizeVariantPromotionQueue(workspace = createTemplateVariantsWorkspace()) {
  const matrix = createTemplateVariantExperimentMatrix(workspace);
  return {
    workspaceId: workspace.id,
    activeExperiments: matrix.filter((entry) => entry.status === 'active').length,
    queuedExperiments: matrix.filter((entry) => entry.status === 'queued').length,
    promotionReady: matrix.filter((entry) => entry.status === 'ready_to_promote').length,
    averageLiftEstimate: Number((matrix.reduce((sum, entry) => sum + entry.liftEstimate, 0) / matrix.length).toFixed(2)),
    nextPromotionLane: matrix.find((entry) => entry.status === 'ready_to_promote')?.lane || matrix[0]?.lane || null
  };
}
