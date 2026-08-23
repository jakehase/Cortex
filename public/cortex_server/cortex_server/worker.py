"""Celery worker configuration and tasks for cortex_server.

Uses native modules for direct execution without API calls.
"""
from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Any, Mapping

from celery import Celery, Task
from celery.exceptions import Reject

# Import native modules for direct execution
from cortex_server.internal_addressing import internal_url
from cortex_server.modules.action_capabilities import (
    DELEGATED_ACTION_CAPABILITY_HEADER,
    assert_action_authorized,
    authorize_deferred_action,
)
from cortex_server.modules.ghost import Ghost
from cortex_server.modules.memory_scope import configured_internal_memory_headers
from cortex_server.modules.ouroboros import Ouroboros


app = Celery(
    "cortex_tasks",
    broker=os.getenv("CORTEX_REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("CORTEX_REDIS_URL", "redis://localhost:6379/0"),
)


class DelegatedActionTask(Task):
    """Celery task base that consumes exact delegated authority at the worker."""

    abstract = True
    consumes_delegated_action_capability = True

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        # The v1 deferred proof binds the positional argument vector.  Refuse
        # keyword arguments until the signed contract binds them too.
        if kwargs:
            raise Reject(
                "delegated action keyword arguments are unsupported",
                requeue=False,
            )
        headers = getattr(self.request, "headers", None)
        capability = (
            headers.get(DELEGATED_ACTION_CAPABILITY_HEADER)
            if isinstance(headers, Mapping)
            else None
        )
        authorization = authorize_deferred_action(
            capability if isinstance(capability, Mapping) else {},
            task=str(self.name or ""),
            args=list(args),
        )
        if authorization is None:
            raise Reject("delegated action capability denied", requeue=False)
        assert_action_authorized(authorization)
        return super().__call__(*args, **kwargs)


def task_consumes_delegated_action_capability(
    task_name: str,
    *,
    celery: Any = None,
) -> bool:
    """Return whether the registered target enforces worker-side consumption."""

    selected_app = celery if celery is not None else app
    tasks = getattr(selected_app, "tasks", {})
    task = tasks.get(str(task_name or "")) if isinstance(tasks, Mapping) else None
    return bool(
        task is not None
        and getattr(task, "consumes_delegated_action_capability", False) is True
    )


def _cortex_write_headers() -> dict[str, str]:
    """Build authorization headers for mutating calls back into Cortex."""
    token = os.getenv("CORTEX_WRITE_TOKEN", "").strip()
    header = os.getenv("CORTEX_WRITE_TOKEN_HEADER", "x-cortex-write-token").strip()
    return {header: token} if token and header else {}


def check_redis_connection() -> bool:
    """Return true only after the configured Celery broker is reachable."""
    try:
        socket_timeout = max(0.1, min(float(os.getenv("CORTEX_REDIS_STARTUP_TIMEOUT_SECONDS", "2.0")), 30.0))
    except ValueError:
        socket_timeout = 2.0
    connection = app.connection_for_read(
        url=os.getenv("CORTEX_REDIS_URL", "redis://localhost:6379/0"),
        transport_options={
            "socket_connect_timeout": socket_timeout,
            "socket_timeout": socket_timeout,
        },
    )
    try:
        connection.ensure_connection(max_retries=0)
        return True
    finally:
        connection.release()


@app.task(name="cortex_tasks.long_running_research")
def long_running_research(topic: str) -> str:
    """Simulate a long-running research task and write a report to disk."""
    time.sleep(10)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    output_dir = "/tmp/cortex_research"
    os.makedirs(output_dir, exist_ok=True)
    filename = f"{topic}_{timestamp}.txt"
    path = os.path.join(output_dir, filename)
    content = f"Research on {topic} completed at {timestamp}"
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    return path


@app.task(name="cortex_tasks.add", base=DelegatedActionTask)
def add(x, y):
    """Simple add task for testing."""
    return x + y


@app.task(bind=True, name="cortex_tasks.process_swarm")
def process_swarm(self, goal: str, context: str | None = None) -> dict:
    """Process a swarm orchestration task using native modules.
    
    Uses Ghost for web search, makes local API calls for Oracle/Librarian.
    """
    import requests
    import uuid
    import json

    ORACLE_URL = internal_url("/oracle/chat")
    QUEUE_URL = internal_url("/queue/schedule")
    LIBRARIAN_EMBED = internal_url("/librarian/embed")

    context_text = context
    novelty_mode = "standard"
    novel_plan = None
    if context:
        try:
            parsed_context = json.loads(context)
            if isinstance(parsed_context, dict):
                context_text = parsed_context.get("context")
                novelty_mode = str(parsed_context.get("novelty_mode") or "standard")
                novel_plan = parsed_context.get("novel_plan")
        except Exception:
            context_text = context

    # Use Ghost natively for web research
    ghost = Ghost()
    search_results = []
    try:
        search_query = f"{goal} history sources"
        search_results = ghost.search(search_query, max_results=3)
    except Exception as e:
        search_results = [{"title": "Search failed", "link": str(e)}]

    # Build context from search results
    sources_text = "\n".join([f"- {r['title']}: {r['link']}" for r in search_results[:2]])

    context_block = f"\n\nUser context: {context_text}" if context_text else ""
    novelty_hint = "\n\nNovelty mode is enabled. Prefer auctioned and verifier-gated subtasks." if novelty_mode == "l3_novel" else ""

    system_prompt = f"""You are a task planner. Use these sources for context:
{sources_text}{context_block}{novelty_hint}

Break the user's goal into exactly 3 distinct, single-sentence sub-tasks. Format as numbered list (1., 2., 3.)."""

    oracle_payload = {
        "prompt": f"Goal: {goal}\n\nBreak this into 3 sub-tasks:",
        "system": system_prompt,
        "model": "tinyllama"
    }

    try:
        oracle_resp = requests.post(ORACLE_URL, json=oracle_payload, headers=_cortex_write_headers(), timeout=60)
        plan_text = oracle_resp.json().get("response", "")
    except Exception as e:
        plan_text = f"Error: {str(e)}"

    sub_tasks = []

    # If novelty plan exists, seed tasks from SAS assignments first.
    if isinstance(novel_plan, dict):
        try:
            sas = ((novel_plan.get("implemented_ideas") or {}).get("1_sas") or {})
            for row in (sas.get("assignments") or [])[:3]:
                task_text = str(row.get("task") or "").strip()
                winner = str(row.get("winner") or "worker")
                if task_text:
                    sub_tasks.append(f"[{winner}] {task_text}")
        except Exception:
            pass

    if len(sub_tasks) < 3:
        for line in plan_text.split('\n'):
            line = line.strip()
            if line and (line.startswith('1.') or line.startswith('2.') or line.startswith('3.')):
                task_text = line[2:].strip()
                if task_text:
                    sub_tasks.append(task_text)

    if len(sub_tasks) < 3:
        sub_tasks = [
            f"Research: {goal}",
            f"Analyze: {goal}",
            f"Summarize: {goal}"
        ]

    # Celery preserves the task id across redelivery.  Deriving child admission
    # keys from it prevents a retried parent from duplicating its three child
    # tasks.  Direct/eager invocations without an id retain a unique fallback.
    master_plan_id = str(getattr(self.request, "id", "") or uuid.uuid4())
    task_ids = []
    for i, task in enumerate(sub_tasks[:3], 1):
        queue_payload = {
            "task": "cortex_tasks.long_running_research",
            "args": [f"Swarm Task {i}: {task}"],
            "idempotency_key": f"swarm:{master_plan_id}:{i}",
        }
        try:
            queue_resp = requests.post(QUEUE_URL, json=queue_payload, headers=_cortex_write_headers(), timeout=10)
            task_id = queue_resp.json().get("task_id")
            if task_id:
                task_ids.append(task_id)
        except:
            task_ids.append(f"failed-{uuid.uuid4()}")

    novelty_summary = None
    if isinstance(novel_plan, dict):
        novelty_summary = {
            "implemented": list((novel_plan.get("implemented_ideas") or {}).keys()),
            "execution_order": novel_plan.get("execution_order"),
        }

    librarian_payload = {
        "text": (
            f"HIVE MASTER PLAN [{master_plan_id}]: {goal}\n"
            f"Plan: {plan_text}\n"
            f"Sources: {json.dumps(search_results)}\n"
            f"Tasks: {json.dumps(task_ids)}\n"
            f"NoveltyMode: {novelty_mode}\n"
            f"NoveltySummary: {json.dumps(novelty_summary)}"
        ),
        "metadata": {
            "type": "swarm_plan",
            "plan_id": master_plan_id,
            "task_ids": task_ids,
            "goal": goal,
            "context": context_text,
            "sources": search_results,
            "novelty_mode": novelty_mode,
            "novelty_summary": novelty_summary,
        }
    }
    try:
        memory_headers = configured_internal_memory_headers()
        if memory_headers is not None:
            requests.post(
                LIBRARIAN_EMBED,
                json=librarian_payload,
                headers={**_cortex_write_headers(), **memory_headers},
                timeout=10,
            )
    except:
        pass

    return {
        "master_plan_id": master_plan_id,
        "plan": plan_text,
        "sources_found": len(search_results),
        "task_ids": task_ids,
        "novelty_mode": novelty_mode,
        "novel_ideas_attached": bool(isinstance(novel_plan, dict)),
        "status": "completed"
    }


@app.task(name="cortex_tasks.ouroboros.run_cycle")
def run_ouroboros():
    """Execute one Ouroboros self-improvement cycle."""
    return Ouroboros().run_cycle()
