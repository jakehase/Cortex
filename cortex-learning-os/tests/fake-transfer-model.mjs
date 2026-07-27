#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1];
};
const logPath = value('--log');
const outputPath = value('--jsonl-output');
if (!logPath) process.exit(2);
const prompt = fs.readFileSync(0, 'utf8');
const concurrentSafe = args.includes('--concurrent-safe');
const rows = !concurrentSafe && fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
const index = rows.length;
if (!concurrentSafe) {
  rows.push({ prompt });
  fs.writeFileSync(logPath, JSON.stringify(rows));
}
const interruptValue = value('--interrupt-at');
const interruptAt = interruptValue === null ? null : Number(interruptValue);
const marker = `${logPath}.interrupted`;
if (interruptAt !== null && Number.isSafeInteger(interruptAt) && index === interruptAt && !fs.existsSync(marker)) {
  fs.writeFileSync(marker, 'once');
  process.exit(7);
}
if (args.includes('--interrupt-baseline-once') && /No transfer context is supplied/.test(prompt)) {
  try {
    fs.writeFileSync(`${logPath}.baseline-interrupted`, 'once', { flag: 'wx' });
    process.exit(7);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
if (args.includes('--malformed')) {
  if (outputPath) fs.writeFileSync(outputPath, 'not-json\n');
  else console.log('not-json');
  process.exit(0);
}
let result = 'false';
const multiply = prompt.match(/operands (-?[0-9]+) and (-?[0-9]+)/);
if (multiply) result = (BigInt(multiply[1]) * BigInt(multiply[2])).toString();
const roots = prompt.match(/integer roots (-?[0-9]+) and (-?[0-9]+)/);
if (roots) {
  const left = BigInt(roots[1]);
  const right = BigInt(roots[2]);
  result = JSON.stringify({
    factors: [[String(-left), '1'], [String(-right), '1']],
    roots: [String(left), String(right)],
  });
}
const events = [
  { type: 'thread.started', thread_id: concurrentSafe ? `fake-${crypto.randomUUID()}` : `fake-call-${index}` },
  ...(args.includes('--tool-event') ? [{ type: 'item.completed', item: { type: 'command_execution', command: 'forbidden' } }] : []),
  { type: 'item.completed', item: { type: 'agent_message', text: result } },
  ...(args.includes('--no-usage') ? [] : [{ type: 'turn.completed', usage: { input_tokens: 100 + index, output_tokens: 3, cached_input_tokens: 0 } }]),
].map(JSON.stringify).join('\n');
if (outputPath) fs.writeFileSync(outputPath, `${events}\n`);
else console.log(events);
