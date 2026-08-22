#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CLOS_ROOT } from './paths.mjs';
import { readJson, writeJson } from './json.mjs';
import { sha256File } from './hash.mjs';
import { runCodexExam, runOpenClawExam } from './model-answer-runner.mjs';
import { writeExamRun } from './exam-runner.mjs';
import { buildMistakes, distillCandidate, selectRemediableFailure } from './learning-loop.mjs';
import { evaluatePromotion } from './promotion.mjs';
import { buildCapabilityReport, buildRetrievalPack } from './retrieval-pack.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const has = (flag) => args.includes(flag);
const compactTimestamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
const runId = value('--run-id') || `math-foundations-smoke-${compactTimestamp()}`;
const artifactRoot = path.resolve(value('--artifact-root') || path.join(CLOS_ROOT, 'artifacts', runId));
const runner = value('--runner') || 'openclaw';
if (!['openclaw', 'codex'].includes(runner)) throw new Error('--runner must be openclaw or codex');
const thinking = value('--thinking') || 'xhigh';
const model = value('--model') || 'gpt-5.6-sol';
const codexCommand = value('--codex-command') || 'codex';
const promoteDefault = has('--promote-default');
const command = process.argv.map((part) => JSON.stringify(part)).join(' ');
const capsulePath = path.join(CLOS_ROOT, 'capsules/math-foundations/capsule.json');
const baselinePath = path.resolve(value('--exam') || path.join(CLOS_ROOT, 'exams/math-foundations/baseline.exam.json'));
const capsule = readJson(capsulePath);
const baseline = readJson(baselinePath);
fs.mkdirSync(artifactRoot, { recursive: true });

function phaseExam(examId, title, item) {
  return {
    schemaVersion: 'cortex.learning_os.exam.v0', examId, capsuleId: capsule.capsuleId,
    version: '0.1.0', title, passThreshold: 1, allowedTools: [], items: [item],
    truthBoundary: `This one-item ${title} supports only the named concept and recorded run.`
  };
}

function modelPhase({ phase, exam, learningContext = null, evidenceRole }) {
  const phaseRoot = path.join(artifactRoot, phase);
  fs.mkdirSync(phaseRoot, { recursive: true });
  const modelRun = runner === 'codex'
    ? runCodexExam({
        exam,
        sessionId: `${runId}-${phase}`,
        runId: `${runId}-${phase}`,
        learningContext,
        evidenceRole,
        thinking,
        model,
        codexCommand,
        timeoutSeconds: 240
      })
    : runOpenClawExam({
        exam,
        sessionId: `${runId}-${phase}`,
        runId: `${runId}-${phase}`,
        learningContext,
        evidenceRole,
        thinking,
        timeoutSeconds: 240
      });
  writeJson(path.join(phaseRoot, 'model_call.json'), modelRun.raw);
  fs.writeFileSync(path.join(phaseRoot, 'model_prompt.txt'), `${modelRun.prompt}\n`);
  return writeExamRun({
    capsule,
    exam,
    answerSet: modelRun.answerSet,
    runId: `${runId}-${phase}`,
    outputDir: phaseRoot,
    command: runner === 'codex'
      ? `${codexCommand} exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --model ${model}`
      : `openclaw agent --session-id ${runId}-${phase} --thinking ${thinking} --json --timeout 240`
  });
}

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(target) : entry.isFile() ? [target] : [];
  });
}

function finalize({ status, reason = null, baselineRun, correctionRun = null, promotionRetestRun = null, heldoutRun = null, mistake = null, candidate = null, promotion = null, retrievalPack = null }) {
  const generatedAt = new Date().toISOString();
  const learningLoopCompleted = Boolean(promotion?.promoted && heldoutRun?.summary?.passed);
  const improvementObserved = Boolean(mistake && heldoutRun?.summary?.passed);
  const outcome = {
    schemaVersion: 'cortex.learning_os.learning_outcome.v0', generatedAt, status, reason,
    learningLoopCompleted, improvementObserved,
    conceptId: mistake?.conceptIds?.[0] || null,
    baselineFailureItemId: mistake?.itemId || null,
    heldoutRetestItemId: heldoutRun?.verifierResults?.[0]?.itemId || null,
    promotionDigest: promotion?.promotionProof?.digest || null,
    comparisonLimitations: [
      'The baseline is a multi-item batch while correction and retest phases contain one item each.',
      'The held-out item differs from the failed baseline item and may differ in difficulty.',
      'The observed sequence does not isolate retrieval-pack causality from added focus or repeated practice.'
    ],
    truthBoundary: 'Improvement means one failed baseline concept was followed by a pass on a different held-out item after a gated retrieval pack. It does not isolate causality or prove broad or durable math improvement.'
  };
  const examRuns = [baselineRun, correctionRun, promotionRetestRun, heldoutRun].filter(Boolean).map((run) => ({
    examId: run.summary.examId, runId: run.summary.runId, score: run.summary.score,
    passed: run.summary.passed, itemCount: run.summary.itemCount,
    evidenceRefs: [path.relative(artifactRoot, run.files.summary)]
  }));
  const report = buildCapabilityReport({ capsule, examRuns, learningOutcome: outcome });
  writeJson(path.join(artifactRoot, 'learning_outcome.json'), outcome);
  writeJson(path.join(artifactRoot, 'capability_report.json'), report);
  const summary = {
    schemaVersion: 'cortex.learning_os.dogfood_summary.v0', runId, generatedAt, status, reason,
    runner: { kind: runner, model: runner === 'codex' ? model : null, thinking },
    baselineScore: baselineRun?.summary?.score ?? null,
    selectedMistakeId: mistake?.mistakeId || null,
    candidateId: candidate?.candidateId || null,
    promotedLessonId: promotion?.trustedLesson?.lessonId || null,
    heldoutRetestPassed: heldoutRun?.summary?.passed ?? null,
    learningLoopCompleted,
    improvementObserved,
    defaultPromoted: false,
    allowedClaims: report.allowedClaims,
    rejectedClaims: report.rejectedClaims,
    truthBoundary: report.truthBoundary
  };
  if (learningLoopCompleted && promoteDefault) {
    const trustedPath = path.join(CLOS_ROOT, 'capsules/math-foundations/trusted_lessons.json');
    const existing = readJson(trustedPath, []);
    const lessons = [...existing.filter((lesson) => lesson.lessonId !== promotion.trustedLesson.lessonId), promotion.trustedLesson];
    writeJson(trustedPath, lessons);
    writeJson(path.join(CLOS_ROOT, 'capsules/math-foundations/latest_retrieval_pack.json'), retrievalPack);
    writeJson(path.join(CLOS_ROOT, 'capsules/math-foundations/capability_report.json'), report);
    writeJson(capsulePath, { ...capsule, trustState: 'candidate', lastQualifiedRun: path.relative(CLOS_ROOT, artifactRoot), updatedAt: generatedAt });
    summary.defaultPromoted = true;
  }
  writeJson(path.join(artifactRoot, 'run_summary.json'), summary);
  const files = allFiles(artifactRoot).filter((file) => !file.endsWith('artifact_manifest.json')).map((file) => ({
    path: path.relative(artifactRoot, file), sha256: sha256File(file)
  })).sort((a, b) => a.path.localeCompare(b.path));
  writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
    schemaVersion: 'cortex.learning_os.run_manifest.v0', runId, generatedAt, files,
    commands: [command],
    truthBoundary: summary.truthBoundary
  });
  console.log(JSON.stringify({ ok: learningLoopCompleted, artifactRoot, summary }, null, 2));
  return learningLoopCompleted;
}

try {
  const baselineRun = modelPhase({ phase: 'baseline', exam: baseline, evidenceRole: 'baseline' });
  const selected = selectRemediableFailure({ exam: baseline, verifierResults: baselineRun.verifierResults });
  if (!selected) {
    finalize({ status: 'blocked_no_observed_mistake', reason: 'The recorded baseline contained no remediable failed item; no mistake or lesson was fabricated.', baselineRun });
    process.exitCode = 3;
  } else {
    const mistakes = buildMistakes({ exam: baseline, attempts: baselineRun.attempts, verifierResults: baselineRun.verifierResults });
    writeJson(path.join(artifactRoot, 'mistakes.json'), mistakes);
    const mistake = mistakes.find((row) => row.itemId === selected.item.itemId);
    const correctionExam = phaseExam('math-foundations-correction-v0', 'Math Foundations Correction v0', selected.item.remediation.correctionItem);
    const correctionContext = `Observed error: ${mistake.rootCause}\nCandidate correction (not yet trusted): ${selected.item.remediation.lessonTemplate.rule}\nBoundary: ${selected.item.remediation.lessonTemplate.contraindications.join(' ')}`;
    const correctionRun = modelPhase({ phase: 'correction', exam: correctionExam, learningContext: correctionContext, evidenceRole: 'correction' });
    if (!correctionRun.summary.passed) {
      finalize({ status: 'blocked_correction_failed', reason: 'The correction item did not pass, so lesson promotion stopped.', baselineRun, correctionRun, mistake });
      process.exitCode = 4;
    } else {
      const retestExam = phaseExam('math-foundations-promotion-retest-v0', 'Math Foundations Promotion Retest v0', selected.item.remediation.promotionRetestItem);
      const promotionRetestRun = modelPhase({ phase: 'promotion-retest', exam: retestExam, learningContext: correctionContext, evidenceRole: 'retest' });
      const evidence = [...correctionRun.verifierResults, ...promotionRetestRun.verifierResults];
      const candidate = distillCandidate({ capsule, mistake, lessonTemplate: selected.item.remediation.lessonTemplate, supportingResults: evidence });
      writeJson(path.join(artifactRoot, 'lesson_candidate.json'), candidate);
      const promotion = evaluatePromotion({ capsule, candidate, verifierResults: evidence });
      writeJson(path.join(artifactRoot, 'promotion_report.json'), promotion.promotionProof);
      writeJson(path.join(artifactRoot, 'trusted_lesson.json'), promotion.trustedLesson);
      if (!promotion.promoted) {
        finalize({ status: 'blocked_promotion_gate', reason: 'At least one declared lesson-promotion gate failed.', baselineRun, correctionRun, promotionRetestRun, mistake, candidate, promotion });
        process.exitCode = 5;
      } else {
        const heldoutItem = selected.item.remediation.heldoutRetestItem;
        const retrievalPack = buildRetrievalPack({
          capsule, task: heldoutItem.prompt, conceptIds: heldoutItem.conceptIds,
          trustedLessons: [promotion.trustedLesson], candidateLessons: [candidate], mistakeWarnings: [mistake], maxTokens: 900
        });
        writeJson(path.join(artifactRoot, 'retrieval_pack.json'), retrievalPack);
        const heldoutExam = phaseExam('math-foundations-heldout-retest-v0', 'Math Foundations Held-out Retest v0', heldoutItem);
        const heldoutRun = modelPhase({ phase: 'heldout-retest', exam: heldoutExam, learningContext: JSON.stringify(retrievalPack), evidenceRole: 'heldout_retest' });
        const green = finalize({ status: heldoutRun.summary.passed ? 'green' : 'blocked_heldout_retest_failed', reason: heldoutRun.summary.passed ? null : 'The held-out post-promotion item failed.', baselineRun, correctionRun, promotionRetestRun, heldoutRun, mistake, candidate, promotion, retrievalPack });
        if (!green) process.exitCode = 6;
      }
    }
  }
} catch (error) {
  const blocker = { schemaVersion: 'cortex.learning_os.blocker.v0', runId, generatedAt: new Date().toISOString(), error: error.message, stack: error.stack, truthBoundary: 'The run failed mechanically; no learning or capability claim is allowed.' };
  writeJson(path.join(artifactRoot, 'blocker.json'), blocker);
  console.error(JSON.stringify({ ok: false, artifactRoot, blocker }, null, 2));
  process.exitCode = 1;
}
