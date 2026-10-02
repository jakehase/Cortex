from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap


SERVER_ROOT = Path(__file__).resolve().parents[1]


def _run_isolated(script: str, root: Path) -> dict:
    working_directory = root / "cwd"
    working_directory.mkdir()
    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH", "")
    environment.update(
        {
            "CORTEX_DB_PATH": str(root / "graph" / "cortex.db"),
            "CORTEX_CHROMA_DIR": str(root / "chroma"),
            "ROUTE_HEALTH_STATE_PATH": str(root / "health" / "route.json"),
            "CORTEX_SCHEDULER_STATE_DIR": str(root / "scheduler"),
            "HOME": str(root / "home"),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": os.pathsep.join(
                value for value in (str(SERVER_ROOT), existing_pythonpath) if value
            ),
        }
    )
    completed = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script), str(root)],
        cwd=working_directory,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    marker = next(
        line.removeprefix("F034_RESULT=")
        for line in completed.stdout.splitlines()
        if line.startswith("F034_RESULT=")
    )
    return json.loads(marker)


def test_importing_persistence_routes_is_read_only(tmp_path):
    (tmp_path / "graph").mkdir()
    result = _run_isolated(
        """
        import builtins
        import json
        import os
        from pathlib import Path
        import sys

        root = Path(sys.argv[1])
        os.environ["CORTEX_ENV"] = "production"
        before = sorted(str(path.relative_to(root)) for path in root.rglob("*"))
        real_open = builtins.open
        getenv_reads = []
        real_getenv = os.getenv
        from collections.abc import MutableMapping

        environment_reads = []

        class TrackingEnvironment(MutableMapping):
            def __init__(self, values):
                self._values = values

            def __getitem__(self, key):
                environment_reads.append(str(key))
                return self._values[key]

            def __setitem__(self, key, value):
                self._values[key] = value

            def __delitem__(self, key):
                del self._values[key]

            def __iter__(self):
                return iter(self._values)

            def __len__(self):
                return len(self._values)

        os.environ = TrackingEnvironment(os.environ)

        def tracking_getenv(name, default=None):
            getenv_reads.append(name)
            return real_getenv(name, default)

        def guarded_open(file, *args, **kwargs):
            if str(file).endswith("/.openclaw/openclaw.json"):
                raise AssertionError("router import read the ambient OpenRouter credential")
            return real_open(file, *args, **kwargs)

        builtins.open = guarded_open
        os.getenv = tracking_getenv
        from cortex_server.modules import route_health
        from cortex_server.routers import browser, knowledge, librarian, nexus
        import cortex_server.main as main

        after = sorted(str(path.relative_to(root)) for path in root.rglob("*"))
        print("F034_RESULT=" + json.dumps({
            "before": before,
            "after": after,
            "app_resolved": main.app._application is not None,
            "graph_resolved": knowledge.service._graph is not None,
            "memory_resolved": librarian._MEMORY_BACKEND is not None,
            "neutral_chroma_dir": librarian.CHROMA_DIR,
            "health_resolved": route_health._ROUTE_HEALTH_INSTANCE is not None,
            "getenv_reads": sorted(set(getenv_reads)),
            "environment_reads": sorted(set(environment_reads)),
        }))
        """,
        tmp_path,
    )

    environment_reads = set(result.pop("environment_reads"))
    assert not {
        "CORTEX_CHROMA_DIR",
        "CORTEX_DB_PATH",
        "CORTEX_HOST",
        "CORTEX_INTERNAL_BASE_URL",
        "CORTEX_PORT",
        "ROUTE_HEALTH_STATE_PATH",
    }.intersection(environment_reads)
    assert result == {
        "before": ["cwd", "graph"],
        "after": ["cwd", "graph"],
        "app_resolved": False,
        "graph_resolved": False,
        "memory_resolved": False,
        "neutral_chroma_dir": "/tmp/cortex-schema-inventory/chroma_db",
        "health_resolved": False,
        "getenv_reads": ["PYDANTIC_DISABLE_PLUGINS"],
    }


def test_schema_inventory_build_does_not_activate_runtime_persistence(tmp_path):
    (tmp_path / "graph").mkdir()
    result = _run_isolated(
        """
        import builtins
        import json
        import os
        from pathlib import Path
        import sys

        root = Path(sys.argv[1])
        os.environ.update({
            "CORTEX_ENV": "production",
            "CORTEX_CHROMA_DIR": "relative/ambient/path",
            "LIBRARIAN_FALLBACK_MAX_BYTES": "not-an-integer",
            "NEXUS_CODEC_MAX_CHARS": "not-an-integer",
            "ROUTE_HEALTH_STATE_PATH": "relative/ambient/route-health.json",
        })
        before = sorted(str(path.relative_to(root)) for path in root.rglob("*"))
        real_open = builtins.open

        def guarded_open(file, *args, **kwargs):
            if str(file).endswith("/.openclaw/openclaw.json"):
                raise AssertionError("schema construction read the ambient OpenRouter credential")
            return real_open(file, *args, **kwargs)

        builtins.open = guarded_open
        from cortex_server.main import create_app

        from collections.abc import MutableMapping

        environment_reads = []
        environment_iterations = 0

        class TrackingEnvironment(MutableMapping):
            def __init__(self, values):
                self._values = values

            def __getitem__(self, key):
                environment_reads.append(str(key))
                return self._values[key]

            def __setitem__(self, key, value):
                self._values[key] = value

            def __delitem__(self, key):
                del self._values[key]

            def __iter__(self):
                global environment_iterations
                environment_iterations += 1
                return iter(self._values)

            def __len__(self):
                return len(self._values)

            def copy(self):
                return self._values.copy()

        os.environ = TrackingEnvironment(os.environ)
        getenv_reads = []
        real_getenv = os.getenv

        def tracking_getenv(name, default=None):
            getenv_reads.append(name)
            return real_getenv(name, default)

        os.getenv = tracking_getenv
        application = create_app(schema_only=True)
        schema = application.openapi()

        async def enter_schema_lifespan():
            async with application.router.lifespan_context(application):
                pass

        import asyncio
        asyncio.run(enter_schema_lifespan())
        schema_getenv_reads = list(getenv_reads)
        schema_environment_reads = list(environment_reads)
        schema_environment_iterations = environment_iterations
        after_schema = sorted(str(path.relative_to(root)) for path in root.rglob("*"))

        os.environ.update({
            "CORTEX_ENV": "development",
            "CORTEX_CHROMA_DIR": str(root / "runtime-chroma"),
            "LIBRARIAN_FALLBACK_MAX_BYTES": "12345",
            "NEXUS_CODEC_MAX_CHARS": "777",
            "ROUTE_HEALTH_STATE_PATH": str(root / "runtime-health" / "route.json"),
        })
        getenv_reads.clear()
        runtime_application = create_app()
        runtime_getenv_reads = list(getenv_reads)
        from cortex_server.modules import route_health
        from cortex_server.routers import knowledge, librarian, nexus
        after_runtime = sorted(str(path.relative_to(root)) for path in root.rglob("*"))
        print("F034_RESULT=" + json.dumps({
            "before": before,
            "after_schema": after_schema,
            "after_runtime": after_runtime,
            "schema_getenv_reads": schema_getenv_reads,
            "schema_environment_reads": schema_environment_reads,
            "schema_environment_iterations": schema_environment_iterations,
            "runtime_getenv_reads": runtime_getenv_reads,
            "paths": len(schema.get("paths", {})),
            "required_paths": {
                path: path in schema.get("paths", {})
                for path in ("/l22/store", "/knowledge/search", "/nexus/orchestrate")
            },
            "persistence_router_failures": [
                row for row in application.state.router_load_report["failed"]
                if row["router"] in {"knowledge", "l22", "librarian", "nexus"}
            ],
            "runtime_router_failures": [
                row for row in runtime_application.state.router_load_report["failed"]
                if row["router"] in {"knowledge", "l22", "librarian", "nexus"}
            ],
            "detached": {
                name: name in application.state.schema_detached_modules
                for name in (
                    "cortex_server.routers.knowledge",
                    "cortex_server.routers.librarian",
                    "cortex_server.routers.nexus",
                )
            },
            "runtime_config": {
                "chroma": librarian.CHROMA_DIR,
                "fallback_max_bytes": librarian._FALLBACK_MAX_BYTES,
                "nexus_codec_max_chars": nexus.NEXUS_CODEC_MAX_CHARS,
            },
            "graph_resolved": knowledge.service._graph is not None,
            "memory_resolved": librarian._MEMORY_BACKEND is not None,
            "health_resolved": route_health._ROUTE_HEALTH_INSTANCE is not None,
        }))
        """,
        tmp_path,
    )

    assert result["before"] == ["cwd", "graph"]
    assert result["after_schema"] == ["cwd", "graph"]
    assert result["after_runtime"] == ["cwd", "graph"]
    assert result["schema_getenv_reads"] == []
    assert result["schema_environment_iterations"] == 0
    assert not {
        "CORTEX_CHROMA_DIR",
        "CORTEX_DB_PATH",
        "LIBRARIAN_FALLBACK_LOG_PATH",
        "NEXUS_REFERENT_STATE_PATH",
        "OPENROUTER_API_KEY",
        "ROUTE_HEALTH_STATE_PATH",
        "CORTEX_SCHEDULER_STATE_DIR",
    }.intersection(result["schema_environment_reads"])
    assert "CORTEX_CHROMA_DIR" in result["runtime_getenv_reads"]
    assert "NEXUS_CODEC_MAX_CHARS" in result["runtime_getenv_reads"]
    assert result["paths"] > 100
    assert result["required_paths"] == {
        "/knowledge/search": True,
        "/l22/store": True,
        "/nexus/orchestrate": True,
    }
    assert result["persistence_router_failures"] == []
    assert result["runtime_router_failures"] == []
    assert result["detached"] == {
        "cortex_server.routers.knowledge": True,
        "cortex_server.routers.librarian": True,
        "cortex_server.routers.nexus": True,
    }
    assert result["runtime_config"] == {
        "chroma": str(tmp_path / "runtime-chroma"),
        "fallback_max_bytes": 12345,
        "nexus_codec_max_chars": 777,
    }
    assert result["graph_resolved"] is False
    assert result["memory_resolved"] is False
    assert result["health_resolved"] is False


def test_runtime_factory_reconfigures_prior_config_neutral_router_imports(tmp_path):
    result = _run_isolated(
        """
        import json
        import os
        from pathlib import Path
        import sys

        root = Path(sys.argv[1])
        os.environ.update({
            "CORTEX_CHROMA_DIR": str(root / "configured-chroma"),
            "CORTEX_INTERNAL_BASE_URL": "http://127.0.0.1:8123",
            "LIBRARIAN_FALLBACK_MAX_BYTES": "12345",
            "NEXUS_CODEC_MAX_CHARS": "777",
        })
        import cortex_server.internal_addressing as addressing
        from cortex_server.routers import librarian as neutral_librarian
        from cortex_server.routers import nexus as neutral_nexus
        neutral = {
            "chroma": neutral_librarian.CHROMA_DIR,
            "fallback": neutral_librarian._FALLBACK_MAX_BYTES,
            "internal": addressing.CORTEX_INTERNAL_BASE_URL,
            "nexus": neutral_nexus.NEXUS_CODEC_MAX_CHARS,
        }
        import cortex_server.main as main
        create_app = main.create_app
        application = create_app()
        runtime_librarian = sys.modules["cortex_server.routers.librarian"]
        runtime_nexus = sys.modules["cortex_server.routers.nexus"]
        print("F034_RESULT=" + json.dumps({
            "neutral": neutral,
            "runtime": {
                "chroma": runtime_librarian.CHROMA_DIR,
                "fallback": runtime_librarian._FALLBACK_MAX_BYTES,
                "internal": addressing.CORTEX_INTERNAL_BASE_URL,
                "main_internal": main.CORTEX_INTERNAL_BASE_URL,
                "nexus": runtime_nexus.NEXUS_CODEC_MAX_CHARS,
            },
            "router_failures": [
                row for row in application.state.router_load_report["failed"]
                if row["router"] in {"knowledge", "librarian", "nexus"}
            ],
            "reconfigured": {
                name: name in application.state.runtime_reconfigured_modules
                for name in (
                    "cortex_server.routers.librarian",
                    "cortex_server.routers.nexus",
                    )
                },
                "module_identity_preserved": {
                    "librarian": neutral_librarian is runtime_librarian,
                    "nexus": neutral_nexus is runtime_nexus,
                },
            }))
        """,
        tmp_path,
    )

    assert result["neutral"]["chroma"] != str(tmp_path / "configured-chroma")
    assert result["neutral"]["fallback"] != 12345
    assert result["neutral"]["internal"] == "http://127.0.0.1:8000"
    assert result["neutral"]["nexus"] != 777
    assert result["runtime"] == {
        "chroma": str(tmp_path / "configured-chroma"),
        "fallback": 12345,
        "internal": "http://127.0.0.1:8123",
        "main_internal": "http://127.0.0.1:8123",
        "nexus": 777,
    }
    assert result["router_failures"] == []
    assert result["reconfigured"] == {
        "cortex_server.routers.librarian": True,
        "cortex_server.routers.nexus": True,
    }
    assert result["module_identity_preserved"] == {
        "librarian": True,
        "nexus": True,
    }


def test_runtime_factory_reconfigures_routers_imported_after_main(tmp_path):
    result = _run_isolated(
        """
        import json
        import os
        from pathlib import Path
        import sys

        root = Path(sys.argv[1])
        os.environ.update({
            "CORTEX_CHROMA_DIR": str(root / "configured-chroma"),
            "CORTEX_DEFAULT_TENANT_ID": "tenant-runtime",
            "CORTEX_DEFAULT_WORKSPACE_ID": "workspace-runtime",
            "LIBRARIAN_FALLBACK_MAX_BYTES": "12345",
            "NEXUS_CODEC_MAX_CHARS": "777",
        })
        from cortex_server.main import create_app
        from cortex_server.routers import librarian, nexus

        sentinel = lambda: {"ok": True, "status": "test-seam"}
        librarian.probe_memory_backend_readiness = sentinel
        neutral = {
            "chroma": librarian.CHROMA_DIR,
            "fallback": librarian._FALLBACK_MAX_BYTES,
            "nexus": nexus.NEXUS_CODEC_MAX_CHARS,
        }
        application = create_app()
        request = librarian.SearchRequest(query="test")
        request_schema = librarian.SearchRequest.model_json_schema()
        print("F034_RESULT=" + json.dumps({
            "neutral": neutral,
            "runtime": {
                "chroma": librarian.CHROMA_DIR,
                "fallback": librarian._FALLBACK_MAX_BYTES,
                "nexus": nexus.NEXUS_CODEC_MAX_CHARS,
            },
            "request_defaults": {
                "tenant": request.tenant_id,
                "workspace": request.workspace_id,
                "schema_tenant": request_schema["properties"]["tenant_id"]["default"],
                "schema_workspace": request_schema["properties"]["workspace_id"]["default"],
            },
            "seam_preserved": librarian.probe_memory_backend_readiness is sentinel,
            "reconfigured": sorted(application.state.runtime_reconfigured_modules),
        }))
        """,
        tmp_path,
    )

    assert result["neutral"] == {
        "chroma": "/tmp/cortex-schema-inventory/chroma_db",
        "fallback": 16 * 1024 * 1024,
        "nexus": 420,
    }
    assert result["runtime"] == {
        "chroma": str(tmp_path / "configured-chroma"),
        "fallback": 12345,
        "nexus": 777,
    }
    assert result["request_defaults"] == {
        "tenant": "tenant-runtime",
        "workspace": "workspace-runtime",
        "schema_tenant": "tenant-runtime",
        "schema_workspace": "workspace-runtime",
    }
    assert result["seam_preserved"] is True
    assert "cortex_server.routers.librarian" in result["reconfigured"]
    assert "cortex_server.routers.nexus" in result["reconfigured"]


def test_lazy_dependencies_initialize_once_on_runtime_use(tmp_path):
    result = _run_isolated(
        """
        import json
        from pathlib import Path
        import sys

        root = Path(sys.argv[1])
        from cortex_server.routers import librarian
        from cortex_server.services import knowledge_service

        calls = []

        class FakeCollection:
            def count(self):
                return 7

        class FakeClient:
            def get_or_create_collection(self, **kwargs):
                calls.append(("collection", kwargs["name"]))
                return FakeCollection()

        class FakeGraph:
            pass

        librarian.CHROMA_DIR = str(root / "chroma")
        librarian._validate_chroma_storage = lambda path: calls.append(("validate", path))
        librarian.chromadb.PersistentClient = lambda *, path: (
            calls.append(("client", path)) or FakeClient()
        )
        librarian.build_embedding_function = lambda: calls.append(("embedding", None)) or object()
        knowledge_service.Graph = lambda: calls.append(("graph", None)) or FakeGraph()

        service = knowledge_service.KnowledgeService()
        before = list(calls)
        count = librarian.collection.count()
        first_graph = service.graph
        second_graph = service.graph
        print("F034_RESULT=" + json.dumps({
            "before": before,
            "calls": calls,
            "count": count,
            "same_graph": first_graph is second_graph,
            "created": sorted(str(path.relative_to(root)) for path in root.rglob("*")),
        }))
        """,
        tmp_path,
    )

    assert result["before"] == []
    assert result["calls"] == [
        ["validate", str(tmp_path / "chroma")],
        ["client", str(tmp_path / "chroma")],
        ["embedding", None],
        ["collection", "cortex_memory"],
        ["graph", None],
    ]
    assert result["count"] == 7
    assert result["same_graph"] is True
    assert result["created"] == ["cwd"]
