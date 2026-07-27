import importlib.util
import os
import pathlib
import tempfile
import time
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parent


def load_module(path: pathlib.Path, env: dict[str, str]):
    previous = {key: os.environ.get(key) for key in env}
    try:
        for key, value in env.items():
            os.environ[key] = value
        name = f"test_{path.stem}_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        for key, old in previous.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old


class OracleExecutorSessionTests(unittest.TestCase):
    def check_ephemeral(self, path: pathlib.Path, base: str):
        mod = load_module(path, {
            'ORACLE_EXECUTOR_SESSION_ID': base,
            'ORACLE_EXECUTOR_SESSION_MODE': 'ephemeral',
            'ORACLE_EXECUTOR_SESSION_BUCKET_MINUTES': '60',
        })
        s1 = mod._session_for_prompt('Need a prediction about what the system needs next')
        s2 = mod._session_for_prompt('Need a prediction about what the system needs next')
        self.assertNotEqual(s1, s2)
        self.assertTrue(s1.startswith(f'{base}-short-') or s1.startswith(f'{base}-general-'))
        self.assertTrue(s2.startswith(f'{base}-short-') or s2.startswith(f'{base}-general-'))

    def check_sticky_bucketed(self, path: pathlib.Path, base: str):
        mod = load_module(path, {
            'ORACLE_EXECUTOR_SESSION_ID': base,
            'ORACLE_EXECUTOR_SESSION_MODE': 'sticky',
            'ORACLE_EXECUTOR_SESSION_BUCKET_MINUTES': '60',
        })
        mod.time.time = lambda: 1_700_000_000
        s1 = mod._session_for_prompt('Explain what happened')
        s2 = mod._session_for_prompt('Explain what happened')
        self.assertEqual(s1, s2)
        self.assertIn(base, s1)
        self.assertRegex(s1, rf'^{base}-short-\d{{12}}-[0-9a-f]{{10}}$')

    def test_local_executor_defaults_to_ephemeral_sessions(self):
        self.check_ephemeral(ROOT / 'oracle_executor.py', 'oracle-gateway')

    def test_ct101_executor_defaults_to_ephemeral_sessions(self):
        self.check_ephemeral(ROOT / 'cortex-vm' / 'oracle_executor.py', 'oracle-prod-bridge')

    def test_local_executor_sticky_mode_is_bucketed(self):
        self.check_sticky_bucketed(ROOT / 'oracle_executor.py', 'oracle-gateway')

    def test_ct101_executor_sticky_mode_is_bucketed(self):
        self.check_sticky_bucketed(ROOT / 'cortex-vm' / 'oracle_executor.py', 'oracle-prod-bridge')

    def test_local_cleanup_prunes_old_and_excess_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            now = 1_700_000_000
            mod = load_module(ROOT / 'oracle_executor.py', {
                'ORACLE_EXECUTOR_SESSION_ID': 'oracle-gateway',
                'ORACLE_EXECUTOR_SESSION_MODE': 'ephemeral',
                'ORACLE_EXECUTOR_SESSION_DIR': tmp,
                'ORACLE_EXECUTOR_SESSION_RETENTION_COUNT': '20',
                'ORACLE_EXECUTOR_SESSION_RETENTION_DAYS': '2',
                'ORACLE_EXECUTOR_SESSION_CLEANUP_INTERVAL_SECONDS': '60',
            })
            entries = [('oracle-gateway-general-old.jsonl', now - 10 * 86400), ('other-session.jsonl', now - 10)]
            for idx in range(22):
                entries.append((f'oracle-gateway-short-{idx:02d}.jsonl', now - idx))
            for name, mtime in entries:
                path = pathlib.Path(tmp) / name
                path.write_text('x')
                os.utime(path, (mtime, mtime))

            removed = mod._prune_local_sessions(now=now, session_dir=tmp)

            self.assertIn('oracle-gateway-general-old.jsonl', removed)
            self.assertIn('oracle-gateway-short-20.jsonl', removed)
            self.assertIn('oracle-gateway-short-21.jsonl', removed)
            self.assertTrue((pathlib.Path(tmp) / 'oracle-gateway-short-00.jsonl').exists())
            self.assertTrue((pathlib.Path(tmp) / 'oracle-gateway-short-19.jsonl').exists())
            self.assertTrue((pathlib.Path(tmp) / 'other-session.jsonl').exists())

    def test_ct101_cleanup_command_targets_oracle_session_prefix(self):
        mod = load_module(ROOT / 'cortex-vm' / 'oracle_executor.py', {
            'ORACLE_EXECUTOR_SESSION_ID': 'oracle-prod-bridge',
            'ORACLE_EXECUTOR_SESSION_MODE': 'ephemeral',
            'ORACLE_EXECUTOR_REMOTE_SESSION_DIR': '/root/.openclaw/agents/main/sessions',
            'ORACLE_EXECUTOR_SESSION_RETENTION_COUNT': '123',
            'ORACLE_EXECUTOR_SESSION_RETENTION_DAYS': '4',
        })
        cmd = mod._build_remote_cleanup_cmd(now=1_700_000_000)
        self.assertIn('oracle-prod-bridge-', cmd)
        self.assertIn('/root/.openclaw/agents/main/sessions', cmd)
        self.assertIn('123', cmd)

    def test_reset_session_key_defaults_to_agent_main(self):
        mod = load_module(ROOT / 'cortex-vm' / 'oracle_executor.py', {
            'ORACLE_EXECUTOR_AGENT': 'oracle',
            'ORACLE_EXECUTOR_RESET_AGENT_SESSION': 'true',
        })
        self.assertTrue(mod.RESET_AGENT_SESSION)
        self.assertEqual(mod.RESET_AGENT_SESSION_KEY, 'agent:oracle:main')

    def test_all_oracle_executors_default_to_xhigh_and_reject_downgrades(self):
        for path in [ROOT / 'oracle_executor.py', ROOT / 'cortex-vm' / 'oracle_executor.py']:
            mod = load_module(path, {})
            self.assertEqual(mod.THINKING, 'xhigh')
            self.assertEqual(mod.health()['thinking'], 'xhigh')
            with self.assertRaisesRegex(RuntimeError, 'must remain xhigh'):
                load_module(path, {'ORACLE_EXECUTOR_THINKING': 'low'})

    def test_all_oracle_invocations_pass_xhigh_to_openclaw(self):
        for path in [ROOT / 'oracle_executor.py', ROOT / 'cortex-vm' / 'oracle_executor.py']:
            mod = load_module(path, {
                'ORACLE_EXECUTOR_RESET_AGENT_SESSION': 'false',
                'ORACLE_EXECUTOR_SESSION_MODE': 'ephemeral',
            })
            captured = {}

            class Result:
                returncode = 0
                stderr = ''
                stdout = '{"result":{"payloads":[{"text":"ok"}]}}'

            def fake_run(cmd, **kwargs):
                captured['cmd'] = cmd
                return Result()

            mod.subprocess.run = fake_run
            mod._maybe_cleanup_local_sessions = lambda: []
            mod._maybe_cleanup_remote_sessions = lambda: []
            result = mod.invoke(mod.InvokeRequest(prompt='test'))
            self.assertEqual(result['response'], 'ok')
            if path.parent.name == 'cortex-vm':
                self.assertIn('--thinking xhigh', captured['cmd'][-1])
            else:
                index = captured['cmd'].index('--thinking')
                self.assertEqual(captured['cmd'][index + 1], 'xhigh')

    def test_extract_json_payload_ignores_plugin_log_prefix(self):
        mod = load_module(ROOT / 'cortex-vm' / 'oracle_executor.py', {
            'ORACLE_EXECUTOR_SESSION_ID': 'oracle-prod-bridge',
            'ORACLE_EXECUTOR_SESSION_MODE': 'ephemeral',
        })
        raw = (
            '\x1b[35m[plugins]\x1b[39m \x1b[36mcortex-route-gate: bypassed internal oracle session=oracle-prod-bridge-short-abc123\x1b[39m\n'
            '\x1b[35m[plugins]\x1b[39m \x1b[36mcortex-memory-bridge: agent_end shape {"key":"oracle-prod-bridge-short-abc123"}\x1b[39m\n'
            '{\n'
            '  "result": {\n'
            '    "payloads": [{"text": "hello"}],\n'
            '    "meta": {"agentMeta": {"sessionId": "oracle-prod-bridge-short-abc123"}}\n'
            '  }\n'
            '}\n'
        )
        data = mod._extract_json_payload(raw)
        self.assertEqual(data['result']['payloads'][0]['text'], 'hello')
        self.assertEqual(data['result']['meta']['agentMeta']['sessionId'], 'oracle-prod-bridge-short-abc123')


if __name__ == '__main__':
    unittest.main()
