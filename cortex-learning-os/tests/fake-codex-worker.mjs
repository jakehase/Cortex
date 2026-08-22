#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const argValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const programPath = process.env.CLOS_FAKE_PROGRAM_PATH;
if (!programPath) {
  console.error('CLOS_FAKE_PROGRAM_PATH is required');
  process.exit(2);
}
const prompt = fs.readFileSync(0, 'utf8');
const outputPath = argValue('--output-last-message');
if (!outputPath) {
  console.error('--output-last-message is required');
  process.exit(2);
}
const itemMatches = [...prompt.matchAll(/"itemId":"([^"]+)"/g)];
if (!itemMatches.length) {
  console.error('itemId not found in prompt');
  process.exit(2);
}
const itemId = itemMatches.at(-1)[1];
const program = JSON.parse(fs.readFileSync(programPath, 'utf8'));
const items = [
  ...program.calibration.items,
  ...program.acquisition.items,
  ...Object.values(program.tracks).flatMap((track) => track.items)
];
const item = items.find((candidate) => candidate.itemId === itemId);
if (!item) {
  console.error(`unknown itemId: ${itemId}`);
  process.exit(2);
}
const hasContext = prompt.includes('Learning context supplied for this run:');
const ordinaryMath = itemId.startsWith('regression-');
const answer = hasContext || ordinaryMath ? String(item.checker.expected) : 'NO-CONTEXT-ANSWER';
fs.writeFileSync(outputPath, `${JSON.stringify({ answers: [{ itemId, answer }] })}\n`);
console.log(JSON.stringify({
  type: 'turn.completed',
  usage: {
    input_tokens: hasContext ? 900 : 500,
    output_tokens: 20,
    cached_input_tokens: 0
  }
}));
