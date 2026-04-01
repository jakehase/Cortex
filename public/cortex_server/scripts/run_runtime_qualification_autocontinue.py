#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path('/root/clawd/public/cortex_server')
DATE = '2026-04-01'
SUP = ROOT / 'scripts' / 'run_runtime_qualification_supervisor.py'
QUAL = ROOT / 'artifacts' / 'qualification' / DATE
DOCS = ROOT / 'docs'


def run(*args, capture=True, check=True, env=None):
    cmd = ['python3', str(SUP), '--date', DATE, *args]
    return subprocess.run(cmd, cwd=str(ROOT), capture_output=capture, text=True, check=check, env=env)


def status():
    proc = run('poll')
    return json.loads(proc.stdout)


def launch(stage):
    env = os.environ.copy()
    if stage.startswith('soak_run_'):
        suffix = stage.split('_')[-1]
        env['CORTEX_CHROMA_DIR'] = str(QUAL / f'soak{suffix}_chroma')
        args = ['run-stage', '--stage', stage, '--background']
    elif stage == 'final_rerun':
        env['CORTEX_CHROMA_DIR'] = str(QUAL / 'final' / 'final_chroma')
        args = ['run-stage', '--stage', stage]
    else:
        args = ['run-stage', '--stage', stage]
    proc = subprocess.run(['python3', str(SUP), '--date', DATE, *args], cwd=str(ROOT), capture_output=True, text=True, env=env, check=True)
    print(f"[launch] {stage}")
    print(proc.stdout)


def build_soak_summary():
    rows = []
    for idx in (1, 2, 3):
        path = QUAL / f'soak_run_{idx}.json'
        if path.exists():
            rows.append(json.loads(path.read_text()))
    if len(rows) != 3:
        return None
    summary = {
        'schema_version': 'cortex.runtime.qualification.soak_summary.v1',
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'run_count': len(rows),
        'runs': [
            {
                'config_id': row.get('config_id'),
                'duration_seconds': row.get('duration_seconds'),
                'avg_trace_p95_ms': ((row.get('summary') or {}).get('avg_trace_p95_ms')),
                'avg_operator_p95_ms': ((row.get('summary') or {}).get('avg_operator_p95_ms')),
                'avg_trace_drift_delta_ms': ((row.get('summary') or {}).get('avg_trace_drift_delta_ms')),
                'failure_case_counts': ((row.get('summary') or {}).get('failure_case_counts')),
            }
            for row in rows
        ],
    }
    trace_p95 = [float(((row.get('summary') or {}).get('avg_trace_p95_ms')) or 0.0) for row in rows]
    drift = [float(((row.get('summary') or {}).get('avg_trace_drift_delta_ms')) or 0.0) for row in rows]
    summary['aggregate'] = {
        'avg_trace_p95_ms': round(sum(trace_p95) / len(trace_p95), 3),
        'max_trace_p95_ms': max(trace_p95),
        'avg_trace_drift_delta_ms': round(sum(drift) / len(drift), 3),
    }
    out = QUAL / 'soak_summary.json'
    out.write_text(json.dumps(summary, indent=2), encoding='utf-8')
    return summary


def pick_metrics(path: Path):
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    summary = data.get('summary') or {}
    trace = summary.get('trace_metrics') or {}
    return {
        'failure_rate': summary.get('failure_rate'),
        'trace_p50_ms': ((trace.get('latency_ms') or {}).get('p50')),
        'trace_p95_ms': ((trace.get('latency_ms') or {}).get('p95')),
        'drift_delta_ms': ((summary.get('drift') or {}).get('overall_delta_ms')),
    }


def write_final_report(state):
    baseline = pick_metrics(QUAL / 'baseline' / 'baseline.benchmark.json')
    final = pick_metrics(QUAL / 'final' / 'final.benchmark.json')
    experiments = json.loads((QUAL / 'experiments' / 'index.json').read_text()) if (QUAL / 'experiments' / 'index.json').exists() else {}
    soak = build_soak_summary() or {}
    validation = json.loads((QUAL / 'validation' / 'validation_summary.json').read_text()) if (QUAL / 'validation' / 'validation_summary.json').exists() else {}
    lines = [
        '# Cortex Runtime Qualification Final Report — 2026-04-01',
        '',
        '## Stage completion checklist',
        '',
    ]
    for row in state.get('stages', []):
        mark = 'x' if row.get('completed') else ' '
        lines.append(f'- [{mark}] {row.get("stage")}: {row.get("label")}')
    lines += [
        '',
        '## Corpus',
        '',
        '- corpus file: `benchmarks/cortex_runtime_qualification_corpus_2026-04-01.json`',
        '- case count: {}'.format(((next((r for r in state.get('stages', []) if r.get('stage') == 'corpus'), {}) or {}).get('details') or {}).get('case_count', 'unknown')),
        '',
        '## Baseline vs final',
        '',
        f'- baseline failure rate: {baseline.get("failure_rate")}',
        f'- final failure rate: {final.get("failure_rate")}',
        f'- baseline trace p50 ms: {baseline.get("trace_p50_ms")}',
        f'- final trace p50 ms: {final.get("trace_p50_ms")}',
        f'- baseline trace p95 ms: {baseline.get("trace_p95_ms")}',
        f'- final trace p95 ms: {final.get("trace_p95_ms")}',
        f'- baseline drift delta ms: {baseline.get("drift_delta_ms")}',
        f'- final drift delta ms: {final.get("drift_delta_ms")}',
        '',
        '## Experiment winner',
        '',
        f'- winner: {experiments.get("winner")}',
        f'- experiment count: {len(experiments.get("experiments") or [])}',
        '',
        '## Soak summary',
        '',
        f'- soak run count: {((soak.get("run_count")) if soak else "unknown")}',
        f'- average trace p95 ms across soak runs: {((soak.get("aggregate") or {}).get("avg_trace_p95_ms")) if soak else None}',
        f'- max trace p95 ms across soak runs: {((soak.get("aggregate") or {}).get("max_trace_p95_ms")) if soak else None}',
        f'- average drift delta ms across soak runs: {((soak.get("aggregate") or {}).get("avg_trace_drift_delta_ms")) if soak else None}',
        '',
        '## Validation',
        '',
        f'- validation returncode: {validation.get("returncode")}',
        f'- validation command: `{ " ".join(validation.get("command") or []) }`',
        '',
        '## Remaining risks',
        '',
        '- Qualification gates are now enforced mechanically by the supervisor state machine and artifact checks.',
        '- Runtime stability still depends on using explicit/winning ONNX embedding settings and isolated Chroma dirs for clean repeated runs.',
        '',
    ]
    out = DOCS / 'CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_2026-04-01.md'
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f"[report] wrote {out}")


def main():
    print('[autocontinue] starting supervisor continuation loop')
    while True:
        s = status()
        next_stage = s.get('next_stage')
        active = s.get('active_process')
        print(f"[status] next={next_stage} active={(active or {}).get('stage')} all_complete={s.get('all_complete')} at={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
        if s.get('all_complete'):
            print('[autocontinue] qualification already complete')
            break
        if active:
            time.sleep(60)
            continue
        if next_stage in {'soak_run_2', 'soak_run_3', 'final_rerun', 'validation'}:
            launch(next_stage)
            time.sleep(5)
            continue
        if next_stage == 'final_report':
            state = status()
            write_final_report(state)
            state = status()
            print('[autocontinue] final report written; rechecking completion')
            if state.get('all_complete'):
                break
            time.sleep(5)
            continue
        if next_stage in {'corpus', 'tuning_loop_a', 'tuning_loop_b'}:
            print(f'[autocontinue] manual stage still missing: {next_stage}; stopping')
            break
        print(f'[autocontinue] unknown next stage: {next_stage}; stopping')
        break

    final_state = status()
    print(json.dumps({'all_complete': final_state.get('all_complete'), 'next_stage': final_state.get('next_stage')}, indent=2))


if __name__ == '__main__':
    main()
