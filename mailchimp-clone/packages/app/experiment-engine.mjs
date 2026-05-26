export function evaluateExperimentReport(experiment, recipientTotal) {
  return experiment.variants.map((variant, index) => {
    const subjectSignal = variant.subject.split(/\s+/).filter(Boolean).length;
    const proofSignal = /proof|save|learn|launch|join|start/i.test(variant.bodyPreview) ? 0.03 : 0.015;
    const urgencySignal = /today|now|new|limited/i.test(variant.subject) ? 0.04 : 0.02;
    const openRate = Math.min(0.76, 0.26 + Math.min(subjectSignal, 10) * 0.018 + urgencySignal + index * 0.01);
    const clickRate = Math.min(0.42, 0.08 + proofSignal + (variant.sampleAudience === 'high_intent' ? 0.05 : 0.02) + index * 0.008);
    return {
      variantId: variant.id,
      label: variant.label,
      recipients: Math.round(recipientTotal * ((index === 0 ? experiment.trafficSplit.variantA : experiment.trafficSplit.variantB) / 100)),
      openRate,
      clickRate,
      revenue: Math.round(recipientTotal * (18 + openRate * 95 + clickRate * 110))
    };
  });
}
