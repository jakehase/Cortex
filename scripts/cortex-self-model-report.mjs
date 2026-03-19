#!/usr/bin/env node
import fs from 'node:fs';
const selfModel = JSON.parse(fs.readFileSync('/root/clawd/state/cortex-self-model.json', 'utf8'));
const contradictions = JSON.parse(fs.readFileSync('/root/clawd/state/cortex-contradictions.json', 'utf8'));
console.log(JSON.stringify({
  generatedAt: selfModel.generatedAt,
  degraded: selfModel.degraded || [],
  confidence: selfModel.confidence || {},
  contradictionCount: (contradictions.contradictions || []).length,
  topRecommendations: (selfModel.recommendations || []).slice(0, 5)
}, null, 2));
