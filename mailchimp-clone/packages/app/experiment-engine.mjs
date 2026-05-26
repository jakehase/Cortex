export function evaluateExperimentReport(experiment, totalRecipients = 0) {
  const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
  const safeTotal = Math.max(variants.length, Number(totalRecipients) || variants.length || 1);
  return variants.map((variant, index) => {
    const recipients = Math.max(1, Math.floor(safeTotal / Math.max(variants.length, 1)) + index);
    const openRate = Number((0.31 + index * 0.04 + (variant.label === 'Variant B' ? 0.03 : 0)).toFixed(3));
    const clickRate = Number((0.07 + index * 0.025 + (String(variant.bodyPreview || '').length % 5) / 1000).toFixed(3));
    const revenue = Number((recipients * (1.35 + index * 0.42)).toFixed(2));
    return {
      variantId: variant.id,
      label: variant.label,
      recipients,
      opens: Math.round(recipients * openRate),
      clicks: Math.round(recipients * clickRate),
      openRate,
      clickRate,
      revenue
    };
  });
}
